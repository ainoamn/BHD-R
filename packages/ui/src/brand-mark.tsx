/** Official BHD wordmark + R product badge (same mark as site header). */
export function BrandMark({ tone = 'default' }: { tone?: 'default' | 'onDark' }) {
  return (
    <span
      className={tone === 'onDark' ? 'logo__product logo__product--on-dark' : 'logo__product'}
      aria-hidden="true"
    >
      <img src="/brand/bhd-official-symbol.svg" alt="" width="82" height="26" />
      <i>R</i>
    </span>
  );
}
