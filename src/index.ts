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
import { runWeeklyPayouts } from "./services/payouts";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173" }));
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/seller", sellerRoutes);
app.use("/orders", orderRoutes);
app.use("/reviews", reviewRoutes);
app.use("/admin", adminRoutes);

export { app };

const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

if (!isLambda) {
  const PORT = process.env.PORT ?? 6713;
  cron.schedule("0 9 * * 1", () => {
    console.log("[cron] Running weekly payouts...");
    runWeeklyPayouts()
      .then((r) => console.log("[cron] Payouts complete:", r))
      .catch((e) => console.error("[cron] Payout error:", e));
  });
  app.listen(PORT, () => {
    console.log(`Craft & Co API running on http://localhost:${PORT}`);
  });
}
