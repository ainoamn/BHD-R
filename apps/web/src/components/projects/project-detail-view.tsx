import { Link } from '@/i18n/navigation';
import { formatOmr } from '@/lib/auctions-catalogue';
import {
  projectStatusLabel,
  unitStatusLabel,
  type DevelopmentProject,
} from '@/lib/development-projects-catalogue';

export function ProjectDetailView({
  locale,
  project,
}: {
  locale: string;
  project: DevelopmentProject;
}) {
  const ar = locale !== 'en';
  const sold = project.units.filter((u) => u.status === 'sold').length;

  return (
    <div className="ap-detail">
      <div>
        <div className="ap-project-cover" style={{ background: project.coverGradient, minHeight: '12rem' }}>
          <span className="ap-card__badge" style={{ position: 'static', marginBottom: '0.65rem' }}>
            {projectStatusLabel(project.status, ar)}
          </span>
          <h2>{ar ? project.titleAr : project.titleEn}</h2>
          <p style={{ margin: '0.35rem 0 0', opacity: 0.92 }}>
            {ar ? project.cityAr : project.cityEn} · {ar ? 'التسليم' : 'Delivery'} {project.deliveryDate}
          </p>
        </div>

        <div className="ap-panel" style={{ marginTop: '1rem' }}>
          <h2>{ar ? 'عن المشروع' : 'About the project'}</h2>
          <p className="ap-card__meta">{ar ? project.descriptionAr : project.descriptionEn}</p>
          <p className="ap-card__meta" style={{ marginTop: '0.75rem' }}>
            {(ar ? project.amenitiesAr : project.amenitiesEn).join(' · ')}
          </p>
          <p className="ap-card__meta" style={{ marginTop: '0.5rem' }}>
            {ar ? 'المطوّر' : 'Developer'}: {ar ? project.developerNameAr : project.developerNameEn}
          </p>
        </div>

        {project.milestones.length > 0 ? (
          <div className="ap-panel" style={{ marginTop: '1rem' }}>
            <h2>{ar ? 'مراحل التنفيذ' : 'Milestones'}</h2>
            {project.milestones.map((m) => (
              <div key={m.id} className="ap-milestone">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <strong>{ar ? m.nameAr : m.nameEn}</strong>
                  <span className="ap-card__meta">{m.progress}%</span>
                </div>
                <div className="ap-milestone__bar">
                  <i style={{ width: `${Math.min(100, Math.max(0, m.progress))}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <aside>
        <div className="ap-panel">
          <h2>
            {ar ? 'الوحدات' : 'Units'}{' '}
            <span className="ap-card__meta">
              ({sold}/{project.units.length} {ar ? 'مباعة' : 'sold'})
            </span>
          </h2>
          <div className="ap-units">
            {project.units.map((unit) => (
              <div key={unit.id} className="ap-unit">
                <strong>{ar ? unit.typeAr : unit.typeEn}</strong>
                <span className="ap-card__meta">
                  {unit.area} m²
                  {unit.bedrooms != null
                    ? ` · ${unit.bedrooms} ${ar ? 'غرف' : 'beds'}`
                    : null}
                </span>
                <span className="ap-card__price">{formatOmr(unit.priceOmr, ar ? 'ar' : 'en')}</span>
                <span className="ap-card__meta">{unitStatusLabel(unit.status, ar)}</span>
              </div>
            ))}
          </div>
        </div>

        {project.paymentPlans.length > 0 ? (
          <div className="ap-panel" style={{ marginTop: '1rem' }}>
            <h2>{ar ? 'خطط الدفع' : 'Payment plans'}</h2>
            {project.paymentPlans.map((plan) => (
              <div key={plan.id} style={{ marginBottom: '0.75rem' }}>
                <strong>{ar ? plan.nameAr : plan.nameEn}</strong>
                <ul className="ap-bid-list">
                  {plan.schedule.map((row) => (
                    <li key={`${plan.id}-${row.pct}-${row.labelEn}`}>
                      <span>{ar ? row.labelAr : row.labelEn}</span>
                      <strong>{row.pct}%</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ marginTop: '1rem' }}>
          <Link className="button button--secondary button--small" href="/projects">
            {ar ? '← كل المشاريع' : '← All projects'}
          </Link>
        </div>
      </aside>
    </div>
  );
}
