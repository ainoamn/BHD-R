import { BadgeEmblem } from '@/components/badges/badge-emblem';
import { LEVEL_LABELS, TIER_LABELS, type BadgeChip } from '@/lib/badges-shared';

function chipTitle(chip: BadgeChip, ar: boolean): string {
  const lang = ar ? 'ar' : 'en';
  return `${ar ? chip.nameAr : chip.nameEn} · ${TIER_LABELS[chip.tier][lang]} ${LEVEL_LABELS[chip.level][lang]}`;
}

/**
 * The badges a property or person currently holds, drawn beside their name. Each one opens its
 * public certificate unless the chips sit inside another link (`linked={false}`).
 */
export function BadgeChips({
  badges,
  locale,
  size = 20,
  max = 3,
  linked = true,
  labelled = false,
  className,
}: {
  badges: readonly BadgeChip[] | null | undefined;
  locale: string;
  size?: number;
  max?: number;
  linked?: boolean;
  labelled?: boolean;
  className?: string;
}) {
  if (!badges?.length) return null;
  const ar = locale !== 'en';
  const shown = badges.slice(0, max);
  const hidden = badges.slice(max);
  return (
    <span
      className={`badge-chips${labelled ? ' badge-chips--labelled' : ''}${className ? ` ${className}` : ''}`}
    >
      {shown.map((chip) => {
        const title = chipTitle(chip, ar);
        const body = (
          <>
            <BadgeEmblem tier={chip.tier} level={chip.level} icon={chip.icon} size={size} />
            {labelled ? (
              <span className="badge-chip__name">{ar ? chip.nameAr : chip.nameEn}</span>
            ) : null}
          </>
        );
        return linked ? (
          <a
            key={chip.serial}
            className={`badge-chip badge-chip--${chip.level}`}
            href={`/${ar ? 'ar' : 'en'}/verify/badge/${chip.serial}`}
            title={title}
            aria-label={title}
          >
            {body}
          </a>
        ) : (
          <span
            key={chip.serial}
            className={`badge-chip badge-chip--${chip.level}`}
            title={title}
            role="img"
            aria-label={title}
          >
            {body}
          </span>
        );
      })}
      {hidden.length ? (
        <span
          className="badge-chips__more"
          title={hidden.map((chip) => chipTitle(chip, ar)).join('\n')}
        >
          +{hidden.length}
        </span>
      ) : null}
    </span>
  );
}
