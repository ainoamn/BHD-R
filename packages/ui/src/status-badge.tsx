export function StatusBadge({
  status,
  label,
}: {
  status: 'positive' | 'warning' | 'negative' | 'neutral';
  label: string;
}) {
  return (
    <span className={`status status--${status}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}
