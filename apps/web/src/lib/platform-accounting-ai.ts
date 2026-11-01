import 'server-only';
import { aiChatJson, resolveAiEndpoint } from '@/lib/ai-chat';
import type {
  PlatformAccountingNarrative,
  PlatformAccountingView,
} from '@/lib/site-admin-shared';

const SYSTEM = [
  'You are the finance and growth analyst for BHD R, a property platform in Oman.',
  'You receive platform pulse metrics, per-organization income/spend, and the site ledger.',
  'Be factual and concise. Never invent numbers. Arabic is clear MSA; English is plain.',
  'Respond with a single JSON object only.',
].join(' ');

const INSTRUCTION = [
  'Return {"summaryAr": string, "summaryEn": string,',
  '"highlights": [{"ar": string, "en": string}],',
  '"risks": [{"ar": string, "en": string}],',
  '"rankedOrganizationIds": string[],',
  '"marketingTips": [{"ar": string, "en": string}]}.',
  'summary: two sentences (max 50 words) on platform money flow and growth readiness.',
  'highlights / risks / marketingTips: at most 4 short bilingual points each (max 12 words).',
  'rankedOrganizationIds: up to 12 org ids ordered by marketing/growth priority',
  '(prefer high income, healthy net, or underused inventory). Use only ids from the input.',
].join(' ');

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function pairs(value: unknown, limit: number): Array<{ ar: string; en: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const ar = text(row.ar, 120);
      const en = text(row.en, 120);
      return ar && en ? [{ ar, en }] : [];
    })
    .slice(0, limit);
}

function rulesFallback(view: PlatformAccountingView): PlatformAccountingNarrative {
  const { pulse, accounts } = view;
  const top = [...accounts].sort((a, b) => b.incomeMinor - a.incomeMinor).slice(0, 8);
  const weak = [...accounts]
    .filter((row) => row.properties > 0 && row.incomeMinor === 0)
    .slice(0, 4);
  return {
    engine: 'rules',
    summaryAr: `دخل العملاء على المنصة ${(pulse.clientIncomeMinor / 1000).toFixed(3)} ر.ع. وصرفهم ${(pulse.clientExpenseMinor / 1000).toFixed(3)} ر.ع. عبر ${pulse.organizations} منشأة و${pulse.properties} عقار.`,
    summaryEn: `Client income on the platform is ${(pulse.clientIncomeMinor / 1000).toFixed(3)} OMR and spend is ${(pulse.clientExpenseMinor / 1000).toFixed(3)} OMR across ${pulse.organizations} orgs and ${pulse.properties} properties.`,
    highlights: top.slice(0, 3).map((row) => ({
      ar: `${row.nameAr}: دخل ${(row.incomeMinor / 1000).toFixed(3)} ر.ع.`,
      en: `${row.nameEn || row.nameAr}: income ${(row.incomeMinor / 1000).toFixed(3)} OMR`,
    })),
    risks: weak.length
      ? weak.map((row) => ({
          ar: `${row.nameAr} لديه عقارات بلا تحصيل ظاهر.`,
          en: `${row.nameEn || row.nameAr} has properties with no recorded intake.`,
        }))
      : [
          {
            ar: 'لا مخاطر واضحة من البيانات الحالية.',
            en: 'No clear risks from the current data.',
          },
        ],
    rankedOrganizationIds: top.map((row) => row.organizationId),
    marketingTips: [
      {
        ar: 'أبرز المنشآت الأعلى دخلاً في مواد التسويق.',
        en: 'Feature the highest-income accounts in marketing.',
      },
      {
        ar: 'تابع المنشآت ذات الوحدات بلا تحصيل.',
        en: 'Follow up accounts with units but no collections.',
      },
    ],
  };
}

/** AI (or rules) narrative for sorting, highlighting, and marketing use of accounting data. */
export async function analyzePlatformAccounting(
  view: PlatformAccountingView,
  oidcToken: string | null,
): Promise<PlatformAccountingNarrative> {
  const fallback = rulesFallback(view);
  const endpoint = resolveAiEndpoint(oidcToken);
  if (!endpoint) return fallback;

  try {
    const result = await aiChatJson(
      endpoint,
      SYSTEM,
      INSTRUCTION,
      {
        currency: view.currency,
        pulse: {
          clientIncomeOmr: Number((view.pulse.clientIncomeMinor / 1000).toFixed(3)),
          clientExpenseOmr: Number((view.pulse.clientExpenseMinor / 1000).toFixed(3)),
          siteIncomeOmr: Number((view.pulse.siteIncomeMinor / 1000).toFixed(3)),
          siteExpenseOmr: Number((view.pulse.siteExpenseMinor / 1000).toFixed(3)),
          estimatedSubscriptionMonthlyOmr: Number(
            (view.pulse.estimatedSubscriptionMonthlyMinor / 1000).toFixed(3),
          ),
          organizations: view.pulse.organizations,
          users: view.pulse.users,
          properties: view.pulse.properties,
          units: view.pulse.units,
        },
        accounts: view.accounts.slice(0, 40).map((row) => ({
          organizationId: row.organizationId,
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          planKey: row.planKey,
          incomeOmr: Number((row.incomeMinor / 1000).toFixed(3)),
          expenseOmr: Number((row.expenseMinor / 1000).toFixed(3)),
          properties: row.properties,
          units: row.units,
          members: row.members,
        })),
        ledger: view.ledger
          .filter((row) => row.status === 'posted')
          .slice(0, 40)
          .map((row) => ({
            kind: row.kind,
            category: row.category,
            amountOmr: Number((row.amountMinor / 1000).toFixed(3)),
            occurredOn: row.occurredOn,
          })),
      },
      'platform accounting',
      50_000,
    );

    const summaryAr = text(result.summaryAr, 500);
    const summaryEn = text(result.summaryEn, 500);
    const allowed = new Set(view.accounts.map((row) => row.organizationId));
    const ranked = Array.isArray(result.rankedOrganizationIds)
      ? result.rankedOrganizationIds
          .filter((id): id is string => typeof id === 'string' && allowed.has(id))
          .slice(0, 12)
      : [];

    const highlights = pairs(result.highlights, 4);
    const risks = pairs(result.risks, 4);
    const marketingTips = pairs(result.marketingTips, 4);
    return {
      engine: 'ai',
      summaryAr: summaryAr || fallback.summaryAr,
      summaryEn: summaryEn || fallback.summaryEn,
      highlights: highlights.length ? highlights : fallback.highlights,
      risks: risks.length ? risks : fallback.risks,
      rankedOrganizationIds: ranked.length ? ranked : fallback.rankedOrganizationIds,
      marketingTips: marketingTips.length ? marketingTips : fallback.marketingTips,
    };
  } catch {
    return fallback;
  }
}
