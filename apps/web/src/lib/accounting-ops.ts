export type ChequeImportRow = {
  chequeNumber: string;
  bankName: string;
  amountMinor: string;
  currency?: string;
  dueOn: string;
  leaseId?: string;
  tenantPartyId?: string;
};

const UUID = /^[0-9a-f-]{36}$/i;

/** Parse a simple CSV: chequeNumber,bankName,amountMajor,dueOn,leaseId? (header optional). */
export function parseChequeImportCsv(text: string): ChequeImportRow[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const start = /cheque|شيك|number|رقم/i.test(lines[0]!) ? 1 : 0;
  const rows: ChequeImportRow[] = [];
  for (const line of lines.slice(start)) {
    const cols = line.split(/[,;\t]/).map((cell) => cell.trim().replace(/^"|"$/g, ''));
    if (cols.length < 4) continue;
    const [chequeNumber, bankName, amountRaw, dueOn, leaseId] = cols;
    if (!chequeNumber || !dueOn) continue;
    const major = amountRaw!.replace(/,/g, '');
    let amountMinor: string;
    if (/^\d+$/.test(major) && !major.includes('.')) {
      amountMinor = (BigInt(major) * 1000n).toString();
    } else if (/^\d+(\.\d{1,3})?$/.test(major)) {
      const [whole, frac = ''] = major.split('.');
      amountMinor = `${whole}${frac.padEnd(3, '0').slice(0, 3)}`.replace(/^0+(?=\d)/, '') || '0';
      if (amountMinor === '0') continue;
    } else continue;
    rows.push({
      chequeNumber: chequeNumber!,
      bankName: bankName || '—',
      amountMinor,
      dueOn: dueOn!,
      ...(leaseId && UUID.test(leaseId) ? { leaseId } : {}),
    });
  }
  return rows;
}
