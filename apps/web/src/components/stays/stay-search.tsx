import { StaySearchBar } from '@/components/stays/stay-search-bar';

export async function StaySearch({
  locale,
  defaults = {},
  compact = false,
  variant,
}: {
  locale: string;
  compact?: boolean;
  variant?: 'hero' | 'compact' | 'inline';
  defaults?: {
    destination?: string;
    checkInOn?: string;
    checkOutOn?: string;
    adults?: string;
    children?: string;
  };
}) {
  const resolvedVariant = variant ?? (compact ? 'compact' : 'hero');
  return <StaySearchBar locale={locale} variant={resolvedVariant} defaults={defaults} />;
}
