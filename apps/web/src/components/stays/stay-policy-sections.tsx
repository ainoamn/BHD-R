'use client';

import { useState } from 'react';
import type { StayPublicDetail } from '@bhd-r/contracts';
import { resolveStayPoliciesFromDetail, type StayPolicySectionKey } from '@bhd-r/contracts';

const COLLAPSE_AFTER = 8;

export function StayPolicySections({
  detail,
  locale,
  className = 'stay-policy-sections',
}: {
  detail: Pick<StayPublicDetail, 'policiesJson' | 'policiesAr' | 'policiesEn'>;
  locale: string;
  className?: string;
}) {
  const ar = locale === 'ar';
  const sections = resolveStayPoliciesFromDetail(detail, locale);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!sections.length) return null;

  return (
    <div className={className}>
      {sections.map((section) => {
        const isEvents = section.key === 'events';
        const isOpen = expanded[section.key] ?? false;
        const visibleLines =
          !isEvents && section.lines.length > COLLAPSE_AFTER && !isOpen
            ? section.lines.slice(0, COLLAPSE_AFTER)
            : section.lines;

        return (
          <section
            key={section.key}
            className={`stay-policy-sections__block stay-policy-sections__block--${section.key}`}
          >
            <h3>{section.title}</h3>
            {isEvents ? (
              <ul className="stay-policy-sections__events">
                {section.lines.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <>
                <ul className="stay-policy-sections__list">
                  {visibleLines.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                {section.lines.length > COLLAPSE_AFTER ? (
                  <button
                    type="button"
                    className="stay-policy-sections__toggle button button--quiet"
                    onClick={() =>
                      setExpanded((current) => ({
                        ...current,
                        [section.key]: !current[section.key as StayPolicySectionKey],
                      }))
                    }
                  >
                    {isOpen
                      ? ar
                        ? 'عرض أقل'
                        : 'Show less'
                      : ar
                        ? 'عرض المزيد'
                        : 'Show more'}
                  </button>
                ) : null}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
