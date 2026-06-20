import { prisma, calcFees } from "../utils/prisma";

type PayoutItem = {
  id: string;
  sellerPayoutCents: number;
  product: { sellerId: string; seller: { id: string; storeName: string } };
};

export async function runWeeklyPayouts() {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setHours(0, 0, 0, 0);
  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodStart.getDate() - 7);

  const unpaidItems = await prisma.orderItem.findMany({
    where: {
      payoutId: null,
      order: {
        status: { in: ["PAID", "SHIPPED", "DELIVERED"] },
        createdAt: { gte: periodStart, lt: periodEnd },
      },
    },
    include: { product: { include: { seller: true } } },
  });

  const bySeller = new Map<string, PayoutItem[]>();
  for (const item of unpaidItems) {
    const sellerId = item.product.sellerId;
    const list = bySeller.get(sellerId) ?? [];
    list.push(item as PayoutItem);
    bySeller.set(sellerId, list);
  }

  const results: Array<{ id: string; amountCents: number }> = [];

  for (const [sellerId, items] of bySeller) {
    const amountCents = items.reduce((s, i) => s + i.sellerPayoutCents, 0);
    const seller = items[0].product.seller;

    const payout = await prisma.payout.create({
      data: {
        sellerId,
        amountCents,
        periodStart,
        periodEnd,
        status: "PENDING",
        orderItems: { connect: items.map((i) => ({ id: i.id })) },
      },
    });

    results.push(payout);
  }

  return {
    processed: results.length,
    totalAmountCents: results.reduce((s, p) => s + p.amountCents, 0),
    demoMode: true,
  };
}

export async function syncProductStockStatus(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.status === "REMOVED") return;

  await prisma.product.update({
    where: { id: productId },
    data: {
      status: product.stockQty <= 0 ? "SOLD_OUT" : "ACTIVE",
    },
  });
}

export async function suspendSellerProducts(sellerId: string) {
  await prisma.product.updateMany({
    where: { sellerId },
    data: { visible: false },
  });
}

export async function activateSellerProducts(sellerId: string) {
  const products = await prisma.product.findMany({ where: { sellerId, status: { not: "REMOVED" } } });
  for (const p of products) {
    await prisma.product.update({
      where: { id: p.id },
      data: {
        visible: true,
        status: p.stockQty <= 0 ? "SOLD_OUT" : "ACTIVE",
      },
    });
  }
}
