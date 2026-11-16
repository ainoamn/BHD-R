'use client';

import { useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  projectStatusLabel,
  type DevelopmentProject,
  type ProjectStatus,
} from '@/lib/development-projects-catalogue';
import { formatOmr } from '@/lib/auctions-catalogue';

const FILTERS: { id: 'all' | ProjectStatus; ar: string; en: string }[] = [
  { id: 'all', ar: 'الكل', en: 'All' },
  { id: 'selling', ar: 'للبيع', en: 'Selling' },
  { id: 'planned', ar: 'مخطط', en: 'Planned' },
  { id: 'delivered', ar: 'مُسلَّم', en: 'Delivered' },
];

export function ProjectsBrowse({
  locale,
  projects,
}: {
  locale: string;
  projects: DevelopmentProject[];
}) {
  const ar = locale !== 'en';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | ProjectStatus>('all');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects
      .filter((p) => (status === 'all' ? true : p.status === status))
      .filter((p) => {
        if (!needle) return true;
        const hay = `${p.titleAr} ${p.titleEn} ${p.cityAr} ${p.cityEn}`.toLowerCase();
        return hay.includes(needle);
      });
  }, [projects, q, status]);

  return (
    <div>
      <div className="ap-tools">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? 'ابحث عن مشروع أو مدينة…' : 'Search project or city…'}
          aria-label={ar ? 'بحث المشاريع' : 'Search projects'}
        />
        <div className="ap-seg" role="group" aria-label={ar ? 'حالة المشروع' : 'Project status'}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={status === f.id ? 'is-active' : undefined}
              onClick={() => setStatus(f.id)}
            >
              {ar ? f.ar : f.en}
            </button>
          ))}
        </div>
      </div>

      <p className="ap-count">
        {ar ? `وجدنا ${filtered.length} مشروعاً` : `${filtered.length} projects`}
      </p>

      {filtered.length === 0 ? (
        <p className="ap-empty">{ar ? 'لا توجد مشاريع مطابقة.' : 'No matching projects.'}</p>
      ) : (
        <div className="ap-list">
          {filtered.map((project) => {
            const available = project.units.filter((u) => u.status === 'available').length;
            const from = Math.min(...project.units.map((u) => u.priceOmr));
            return (
              <Link key={project.id} href={`/projects/${project.id}`} className="ap-row" prefetch>
                <div
                  className="ap-row__cover"
                  style={{ background: project.coverGradient }}
                  aria-hidden
                >
                  {projectStatusLabel(project.status, ar)}
                </div>
                <div className="ap-row__main">
                  <h3>{ar ? project.titleAr : project.titleEn}</h3>
                  <p className="ap-row__meta">{ar ? project.cityAr : project.cityEn}</p>
                  <p className="ap-row__meta">
                    {ar ? 'التسليم' : 'Delivery'}: {project.deliveryDate}
                  </p>
                </div>
                <div className="ap-row__side">
                  <p className="ap-row__price">
                    {ar ? 'من ' : 'From '}
                    {formatOmr(from, ar ? 'ar' : 'en')}
                  </p>
                  <p className="ap-row__timer">
                    {available} {ar ? 'وحدة متاحة' : 'units available'}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
