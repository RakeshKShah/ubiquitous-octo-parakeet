import { Router } from "express";
import { z } from "zod";
import { prisma, calcFees } from "../utils/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { notifySellerOrderPaid } from "../services/email";
import { syncProductStockStatus } from "../services/payouts";

const router = Router();

type LineItem = {
  product: {
    id: string;
    sellerId: string;
    priceCents: number;
    title: string;
    seller: { storeName: string; user: { email: string } };
  };
  qty: number;
};

const checkoutSchema = z.object({
  items: z.array(
    z.object({
      product_id: z.string(),
      qty: z.number().int().positive(),
    }),
  ).min(1),
});

router.post("/checkout", requireAuth, requireRole("BUYER"), async (req, res) => {
  try {
    const data = checkoutSchema.parse(req.body);

    const lineItems: LineItem[] = [];
    let totalCents = 0;

    for (const item of data.items) {
      const product = await prisma.product.findFirst({
        where: {
          id: item.product_id,
          visible: true,
          status: { in: ["ACTIVE", "SOLD_OUT"] },
          stockQty: { gte: item.qty },
        },
        include: { seller: { include: { user: true } } },
      });

      if (!product || product.stockQty <= 0) {
        return res.status(400).json({ error: `Product ${item.product_id} unavailable` });
      }

      const lineTotal = product.priceCents * item.qty;
      totalCents += lineTotal;
      lineItems.push({
        product: {
          id: product.id,
          sellerId: product.sellerId,
          priceCents: product.priceCents,
          title: product.title,
          seller: { storeName: product.seller.storeName, user: product.seller.user },
        },
        qty: item.qty,
      });
    }

    const { platformFeeCents } = calcFees(totalCents);

    const order = await prisma.order.create({
      data: {
        buyerId: req.user!.id,
        totalCents,
        platformFeeCents,
        status: "PENDING",
        items: {
          create: lineItems.map(({ product, qty }) => {
            const fees = calcFees(product.priceCents * qty);
            return {
              productId: product.id,
              sellerId: product.sellerId,
              qty,
              priceAtPurchase: product.priceCents,
              sellerPayoutCents: fees.sellerPayoutCents,
            };
          }),
        },
      },
      include: {
        items: { include: { product: { include: { seller: { include: { user: true } } } } } },
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: "PAID" } });
      for (const item of lineItems) {
        await tx.product.update({
          where: { id: item.product.id },
          data: { stockQty: { decrement: item.qty } },
        });
        await syncProductStockStatus(item.product.id);
      }
    });

    for (const item of order.items) {
      await notifySellerOrderPaid(
        item.product.seller.user.email,
        item.product.seller.storeName,
        item.product.title,
        item.qty,
      );
    }

    return res.json({
      order_id: order.id,
      demo_mode: true,
      client_secret: null,
      message: "Order placed",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message });
    }
    console.error(err);
    res.status(500).json({ error: "Checkout failed" });
  }
});

router.get("/", requireAuth, requireRole("BUYER"), async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { buyerId: req.user!.id },
    include: {
      items: { include: { product: true, review: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(orders);
});

router.get("/:id", requireAuth, async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: String(req.params.id) },
    include: {
      buyer: { include: { sellerProfile: true } },
      items: { include: { product: true, review: { include: { buyer: { select: { email: true } } } } } },
    },
  });

  if (!order) return res.status(404).json({ error: "Order not found" });

  const isBuyer = order.buyerId === req.user!.id;
  const isSeller = order.items.some(
    (i: { product: { sellerId: string } }) => i.product.sellerId === req.user!.sellerProfileId,
  );
  const isAdmin = req.user!.role === "ADMIN";

  if (!isBuyer && !isSeller && !isAdmin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  res.json(order);
});

router.post("/:id/ship", requireAuth, async (req, res) => {
  if (req.user!.role !== "SELLER" || req.user!.status !== "ACTIVE") {
    return res.status(403).json({ error: "Active seller required" });
  }

  const order = await prisma.order.findUnique({
    where: { id: String(req.params.id) },
    include: { items: { include: { product: true } } },
  });

  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status !== "PAID" && order.status !== "SHIPPED") {
    return res.status(400).json({ error: "Order not ready to ship" });
  }

  const sellerItems = order.items.filter(
    (i: { product: { sellerId: string } }) => i.product.sellerId === req.user!.sellerProfileId,
  );
  if (sellerItems.length === 0) {
    return res.status(403).json({ error: "No items for your shop in this order" });
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { status: "SHIPPED" },
  });

  res.json({ success: true, status: "SHIPPED" });
});

router.post("/:id/deliver", requireAuth, async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: String(req.params.id) } });
  if (!order) return res.status(404).json({ error: "Order not found" });

  const isBuyer = order.buyerId === req.user!.id;
  const isAdmin = req.user!.role === "ADMIN";
  if (!isBuyer && !isAdmin) {
    return res.status(403).json({ error: "Only the buyer or admin can confirm delivery" });
  }

  if (order.status !== "SHIPPED" && order.status !== "PAID") {
    return res.status(400).json({ error: "Order must be shipped before marking delivered" });
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { status: "DELIVERED" },
  });

  res.json({ success: true, status: "DELIVERED" });
});

export default router;
