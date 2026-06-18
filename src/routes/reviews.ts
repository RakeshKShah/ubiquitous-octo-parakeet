import { Router } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

const reviewSchema = z.object({
  order_item_id: z.string(),
  rating: z.number().int().min(1).max(5),
  body: z.string().min(1).max(1000),
});

router.post("/", requireAuth, requireRole("BUYER"), async (req, res) => {
  try {
    const data = reviewSchema.parse(req.body);

    const orderItem = await prisma.orderItem.findUnique({
      where: { id: data.order_item_id },
      include: { order: true, review: true },
    });

    if (!orderItem || orderItem.order.buyerId !== req.user!.id) {
      return res.status(404).json({ error: "Order item not found" });
    }

    // BR-08: validate order status = delivered
    if (orderItem.order.status !== "DELIVERED") {
      return res.status(400).json({
        error: "Reviews are only allowed after the order has been delivered",
      });
    }

    if (orderItem.review) {
      return res.status(400).json({ error: "Already reviewed" });
    }

    const review = await prisma.review.create({
      data: {
        orderItemId: data.order_item_id,
        productId: orderItem.productId,
        buyerId: req.user!.id,
        rating: data.rating,
        body: data.body,
      },
    });

    res.status(201).json(review);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message });
    }
    res.status(500).json({ error: "Failed to submit review" });
  }
});

export default router;
