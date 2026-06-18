import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export async function notifySellerOrderPaid(
  sellerEmail: string,
  storeName: string,
  productTitle: string,
  qty: number,
) {
  if (!resend) {
    console.log(`[email demo] New order for ${storeName}: ${qty}x ${productTitle} → ${sellerEmail}`);
    return;
  }

  await resend.emails.send({
    from: process.env.FROM_EMAIL ?? "Craft & Co <orders@craftco.com>",
    to: sellerEmail,
    subject: `New order for ${productTitle}`,
    html: `<p>Hi ${storeName},</p><p>You have a new order: <strong>${qty}x ${productTitle}</strong>.</p><p>Log in to your seller dashboard to mark it shipped.</p>`,
  });
}
