/** Visual mark that separates a new lease contract from a renewal addendum. */
export function contractKindTone(
  kind: string | null | undefined,
): 'new' | 'renewal' | 'amendment' | 'other' {
  if (kind === 'renewal') return 'renewal';
  if (kind === 'amendment' || kind === 'termination') return 'amendment';
  if (!kind || kind === 'initial') return 'new';
  return 'other';
}

export function contractKindChipLabel(kind: string | null | undefined, ar: boolean): string {
  const tone = contractKindTone(kind);
  if (tone === 'renewal') return ar ? 'عقد تجديد' : 'Renewal contract';
  if (tone === 'amendment') {
    if (kind === 'termination') return ar ? 'ملحق إلغاء' : 'Cancellation addendum';
    return ar ? 'ملحق تعديل' : 'Amendment';
  }
  return ar ? 'عقد جديد' : 'New contract';
}

export function ContractKindChip({
  kind,
  ar,
  className = '',
}: {
  kind: string | null | undefined;
  ar: boolean;
  className?: string;
}) {
  const tone = contractKindTone(kind);
  return (
    <span
      className={`contract-kind-chip contract-kind-chip--${tone}${className ? ` ${className}` : ''}`}
    >
      {contractKindChipLabel(kind, ar)}
    </span>
  );
}
