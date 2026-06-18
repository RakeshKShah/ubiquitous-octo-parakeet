import { Router } from "express";
import { prisma } from "../utils/prisma";
import { requireAuth, requireActiveSeller } from "../middleware/auth";

const router = Router();

router.get("/dashboard", requireAuth, requireActiveSeller, async (req, res) => {
  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: req.user!.id },
    include: {
      products: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!seller) return res.status(404).json({ error: "Seller profile not found" });

  const orderItems = await prisma.orderItem.findMany({
    where: { product: { sellerId: seller.id } },
    include: {
      product: true,
      order: { include: { buyer: { select: { email: true } } } },
    },
    orderBy: { order: { createdAt: "desc" } },
    take: 50,
  });

  const earnings = orderItems.reduce((s, i) => s + i.sellerPayoutCents, 0);

  res.json({
    store_name: seller.storeName,
    bio: seller.bio,
    status: req.user!.status,
    products: seller.products,
    orders: orderItems.map((i) => ({
      id: i.id,
      order_id: i.orderId,
      product_title: i.product.title,
      qty: i.qty,
      buyer_email: i.order.buyer.email,
      order_status: i.order.status,
      seller_payout_cents: i.sellerPayoutCents,
      created_at: i.order.createdAt,
    })),
    total_earnings_cents: earnings,
  });
});

export default router;
