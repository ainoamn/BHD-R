export function Logo({ descriptor, compact = false }: { descriptor: string; compact?: boolean }) {
  return (
    <span className={compact ? 'logo logo--compact' : 'logo'} aria-label={`BHD R — ${descriptor}`}>
      <span className="logo__product" aria-hidden="true">
        <img src="/brand/bhd-official-symbol.svg" alt="" width="82" height="26" />
        <i>R</i>
      </span>
      {compact ? null : <span className="logo__descriptor">{descriptor}</span>}
    </span>
  );
}
