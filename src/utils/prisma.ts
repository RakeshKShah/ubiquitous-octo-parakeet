import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });

export const PLATFORM_FEE_RATE = 0.1;

export function calcFees(totalCents: number) {
  const platformFeeCents = Math.round(totalCents * PLATFORM_FEE_RATE);
  const sellerPayoutCents = totalCents - platformFeeCents;
  return { platformFeeCents, sellerPayoutCents };
}

export function deriveProductStatus(stockQty: number, status: string): string {
  if (status === "REMOVED") return "removed";
  if (stockQty <= 0) return "sold_out";
  return "active";
}
