import { Router } from "express";
import { z } from "zod";
import { prisma, deriveProductStatus } from "../utils/prisma";
import { optionalAuth, requireAuth, requireActiveSeller } from "../middleware/auth";
import { syncProductStockStatus } from "../services/payouts";

const router = Router();

const productSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  price_cents: z.number().int().positive(),
  stock_qty: z.number().int().min(0),
  photos: z.array(z.string().url()).default([]),
});

function formatProduct(p: {
  id: string;
  title: string;
  description: string;
  category: string;
  priceCents: number;
  stockQty: number;
  photos: unknown;
  status: string;
  visible: boolean;
  seller?: { storeName: string; userId: string };
}) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    category: p.category,
    price_cents: p.priceCents,
    stock_qty: p.stockQty,
    photos: p.photos,
    status: deriveProductStatus(p.stockQty, p.status),
    visible: p.visible,
    store_name: p.seller?.storeName,
  };
}

router.get("/", optionalAuth, async (req, res) => {
  const { category, keyword, in_stock } = req.query;
  const isAdmin = req.user?.role === "ADMIN";

  const products = await prisma.product.findMany({
    where: {
      status: { not: "REMOVED" },
      ...(!isAdmin ? { visible: true } : {}),
      ...(category ? { category: String(category) } : {}),
      ...(keyword
        ? {
            OR: [
              { title: { contains: String(keyword), mode: "insensitive" } },
              { description: { contains: String(keyword), mode: "insensitive" } },
            ],
          }
        : {}),
      ...(in_stock === "true" ? { stockQty: { gt: 0 } } : {}),
    },
    include: { seller: true },
    orderBy: { createdAt: "desc" },
  });

  res.json(products.map(formatProduct));
});

// BR-01: reject if seller status = pending
router.post("/", requireAuth, async (req, res) => {
  if (req.user!.role !== "SELLER") {
    return res.status(403).json({ error: "Seller access required" });
  }
  if (req.user!.status === "PENDING") {
    return res.status(403).json({ error: "Seller account must be approved before listing products" });
  }
  if (req.user!.status === "SUSPENDED") {
    return res.status(403).json({ error: "Suspended sellers cannot create products" });
  }

  try {
    const data = productSchema.parse(req.body);
    const seller = await prisma.sellerProfile.findUnique({ where: { userId: req.user!.id } });
    if (!seller) return res.status(404).json({ error: "Seller profile not found" });

    const product = await prisma.product.create({
      data: {
        sellerId: seller.id,
        title: data.title,
        description: data.description,
        category: data.category,
        priceCents: data.price_cents,
        stockQty: data.stock_qty,
        photos: data.photos,
        status: data.stock_qty <= 0 ? "SOLD_OUT" : "ACTIVE",
        visible: true,
      },
    });

    res.status(201).json(product);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message });
    }
    res.status(500).json({ error: "Failed to create product" });
  }
});

router.get("/:id/reviews", async (req, res) => {
  const reviews = await prisma.review.findMany({
    where: { productId: req.params.id },
    include: { buyer: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      created_at: r.createdAt,
      buyer_email: r.buyer.email.replace(/(.{2}).*(@.*)/, "$1***$2"),
    })),
  );
});

router.get("/:id", optionalAuth, async (req, res) => {
  const isAdmin = req.user?.role === "ADMIN";
  const product = await prisma.product.findFirst({
    where: {
      id: req.params.id,
      status: { not: "REMOVED" },
      ...(!isAdmin ? { visible: true } : {}),
    },
    include: {
      seller: true,
      reviews: { include: { buyer: { select: { email: true } } }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json({
    ...formatProduct(product),
    reviews: product.reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      created_at: r.createdAt,
      buyer_email: r.buyer.email.replace(/(.{2}).*(@.*)/, "$1***$2"),
    })),
  });
});

router.put("/:id", requireAuth, requireActiveSeller, async (req, res) => {
  try {
    const data = productSchema.partial().parse(req.body);
    const seller = await prisma.sellerProfile.findUnique({ where: { userId: req.user!.id } });
    if (!seller) return res.status(404).json({ error: "Seller profile not found" });

    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, sellerId: seller.id, status: { not: "REMOVED" } },
    });
    if (!existing) return res.status(404).json({ error: "Product not found" });

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.price_cents !== undefined ? { priceCents: data.price_cents } : {}),
        ...(data.stock_qty !== undefined ? { stockQty: data.stock_qty } : {}),
        ...(data.photos !== undefined ? { photos: data.photos } : {}),
      },
    });

    await syncProductStockStatus(product.id);
    const updated = await prisma.product.findUnique({ where: { id: product.id } });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message });
    }
    res.status(500).json({ error: "Failed to update product" });
  }
});

router.delete("/:id", requireAuth, requireActiveSeller, async (req, res) => {
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: req.user!.id } });
  if (!seller) return res.status(404).json({ error: "Seller profile not found" });

  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, sellerId: seller.id },
  });
  if (!existing) return res.status(404).json({ error: "Product not found" });

  await prisma.product.update({
    where: { id: req.params.id },
    data: { status: "REMOVED", visible: false },
  });

  res.json({ success: true });
});

export default router;
