import type { StayPublicDetail } from '@bhd-r/contracts';
import { resolveStayPoliciesFromDetail } from '@bhd-r/contracts';

export function StayPolicySections({
  detail,
  locale,
  className = 'stay-policy-sections',
}: {
  detail: Pick<StayPublicDetail, 'policiesJson' | 'policiesAr' | 'policiesEn'>;
  locale: string;
  className?: string;
}) {
  const sections = resolveStayPoliciesFromDetail(detail, locale);
  if (!sections.length) return null;

  return (
    <div className={className}>
      {sections.map((section) => (
        <section
          key={section.key}
          className="stay-policy-sections__block"
        >
          <h3>{section.title}</h3>
          <ul>
            {section.lines.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
