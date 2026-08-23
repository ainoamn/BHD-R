import { addMoney, type MoneyValue } from './money.js';

export interface InvoiceLineInput {
  description: string;
  quantity: string;
  unitAmount: MoneyValue;
  taxRateBasisPoints?: number;
}

export interface CalculatedInvoiceLine extends InvoiceLineInput {
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

export function calculateInvoice(lines: readonly InvoiceLineInput[]): {
  lines: CalculatedInvoiceLine[];
  subtotal: MoneyValue;
  tax: MoneyValue;
  total: MoneyValue;
} {
  if (lines.length === 0) throw new RangeError('Invoice requires at least one line');
  const calculated = lines.map((line) => {
    const quantityParts = line.quantity.split('.');
    const fractionDigits = quantityParts[1]?.length ?? 0;
    if (fractionDigits > 3) throw new RangeError('Quantity supports at most three decimal places');
    const scale = 10n ** BigInt(fractionDigits);
    const scaledQuantity = BigInt(quantityParts.join(''));
    const product = line.unitAmount.amountMinor * scaledQuantity;
    if (product % scale !== 0n) throw new RangeError('Line subtotal cannot be represented exactly');
    const subtotalMinor = product / scale;
    const rate = BigInt(line.taxRateBasisPoints ?? 0);
    if (rate < 0n || rate > 10_000n) throw new RangeError('Tax rate out of range');
    const taxMinor = (subtotalMinor * rate + 5_000n) / 10_000n;
    return { ...line, subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
  });
  const prototype = lines[0]!.unitAmount;
  const money = (amountMinor: bigint): MoneyValue => ({ ...prototype, amountMinor });
  const subtotal = addMoney(calculated.map((line) => money(line.subtotalMinor)));
  const tax = addMoney(calculated.map((line) => money(line.taxMinor)));
  return { lines: calculated, subtotal, tax, total: addMoney([subtotal, tax]) };
}
