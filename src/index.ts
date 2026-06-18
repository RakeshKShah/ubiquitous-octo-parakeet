import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import authRoutes from "./routes/auth";
import productRoutes from "./routes/products";
import sellerRoutes from "./routes/seller";
import orderRoutes from "./routes/orders";
import reviewRoutes from "./routes/reviews";
import adminRoutes from "./routes/admin";
import webhookRoutes from "./routes/webhook";
import { runWeeklyPayouts } from "./services/payouts";

const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173" }));

// Stripe webhook needs raw body — mount before json parser
app.use("/webhook", webhookRoutes);

app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/seller", sellerRoutes);
app.use("/orders", orderRoutes);
app.use("/reviews", reviewRoutes);
app.use("/admin", adminRoutes);

// BR-06: Cron runs every Monday at 9:00 AM
cron.schedule("0 9 * * 1", () => {
  console.log("[cron] Running weekly payouts...");
  runWeeklyPayouts()
    .then((r) => console.log("[cron] Payouts complete:", r))
    .catch((e) => console.error("[cron] Payout error:", e));
});

app.listen(PORT, () => {
  console.log(`Craft & Co API running on http://localhost:${PORT}`);
});
