import { Router, raw } from "express";
import { prisma } from "../utils/prisma";
import { stripe } from "../services/stripe";
import { notifySellerOrderPaid } from "../services/email";
import { syncProductStockStatus } from "../services/payouts";
import type Stripe from "stripe";

const router = Router();

router.post(
  "/stripe",
  raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(400).json({ error: "Webhook not configured" });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      return res.status(400).json({ error: "Invalid signature" });
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const orderId = intent.metadata?.orderId;
      if (!orderId) return res.json({ received: true });

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: { include: { seller: { include: { user: true } } } } } },
        },
      });

      if (!order || order.status === "PAID") return res.json({ received: true });

      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "PAID", stripePaymentIntentId: intent.id },
        });

        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQty: { decrement: item.qty } },
          });
        }
      });

      for (const item of order.items) {
        await syncProductStockStatus(item.productId);
        await notifySellerOrderPaid(
          item.product.seller.user.email,
          item.product.seller.storeName,
          item.product.title,
          item.qty,
        );
      }
    }

    res.json({ received: true });
  },
);

export default router;
