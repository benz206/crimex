export type Cents = number & { readonly __brand: "Cents" };

export function cents(n: number): Cents {
  if (!Number.isInteger(n)) throw new Error("Cents must be an integer");
  return n as Cents;
}

export function clampPriceCents(n: number): Cents {
  if (!Number.isInteger(n)) throw new Error("priceCents must be an integer");
  if (n < 0 || n > 100) throw new Error("priceCents out of range");
  return n as Cents;
}

export function qty(n: number): number {
  if (!Number.isInteger(n)) throw new Error("qty must be an integer");
  if (n <= 0) throw new Error("qty must be > 0");
  return n;
}
