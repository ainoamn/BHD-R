export function Logo({ descriptor, compact = false }: { descriptor: string; compact?: boolean }) {
  return (
    <span className={compact ? 'logo logo--compact' : 'logo'} aria-label={`BHD R — ${descriptor}`}>
      <span className="logo__monogram" aria-hidden="true">
        <b>BHD</b>
        <i>R</i>
      </span>
      {compact ? null : <span className="logo__descriptor">{descriptor}</span>}
    </span>
  );
}
