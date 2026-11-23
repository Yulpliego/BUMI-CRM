export interface QuoteLine { productId?: number | null; product: string; quantity: number; price: number; discount: number; }

export function netLine(row: QuoteLine) {
  const price = BigInt(Math.round(row.price * 100));
  const discount = BigInt(Math.round(row.discount * 100));
  const quantity = BigInt(row.quantity);
  return Number((price * quantity * (10_000n - discount) + 5_000n) / 10_000n) / 100;
}

