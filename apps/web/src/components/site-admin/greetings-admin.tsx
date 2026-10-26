'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import {
  audienceSummary,
  emptyGreetingAudience,
  GREETING_AUDIENCE_PRESETS,
  type GreetingAudience,
  type GreetingAudienceEstimate,
  type GreetingCampaign,
  type GreetingDesignVersion,
} from '@/lib/greeting-campaigns-shared';
import { adminDate, adminErrorText, adminGet, type AdminNotice } from './admin-fetch';

function currentDesign(campaign: GreetingCampaign): GreetingDesignVersion | null {
  if (!campaign.currentDesignId) return campaign.designs[0] ?? null;
  return campaign.designs.find((d) => d.id === campaign.currentDesignId) ?? campaign.designs[0] ?? null;
}

function designPreviewSrc(campaignId: string, design: GreetingDesignVersion): string {
  return `/api/public/greeting-card/${campaignId}/${design.id}`;
}

function togglePreset(audience: GreetingAudience, presetId: string): GreetingAudience {
  if (presetId === 'all') return emptyGreetingAudience();
  const preset = GREETING_AUDIENCE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return audience;
  // Re-click removes that facet when already present.
  if (presetId === 'ar' && audience.locales.includes('ar')) {
    return { ...audience, locales: audience.locales.filter((l) => l !== 'ar') };
  }
  if (presetId === 'en' && audience.locales.includes('en')) {
    return { ...audience, locales: audience.locales.filter((l) => l !== 'en') };
  }
  if (presetId === 'tenant' && audience.roles.includes('tenant')) {
    return { ...audience, roles: audience.roles.filter((r) => r !== 'tenant') };
  }
  if (presetId === 'owner' && audience.roles.includes('owner')) {
    return { ...audience, roles: audience.roles.filter((r) => r !== 'owner') };
  }
  if (presetId === 'staff' && audience.roles.includes('staff')) {
    return { ...audience, roles: audience.roles.filter((r) => r !== 'staff') };
  }
  if (presetId === 'omani' && audience.nationalities.some((n) => n.toUpperCase() === 'OM')) {
    return {
      ...audience,
      nationalities: audience.nationalities.filter((n) => n.toUpperCase() !== 'OM'),
    };
  }
  if (presetId === 'expat' && audience.nationalities.some((n) => n.toUpperCase() === 'EXPAT')) {
    return {
      ...audience,
      nationalities: audience.nationalities.filter((n) => n.toUpperCase() !== 'EXPAT'),
    };
  }
  if (presetId === 'male' && audience.genders.includes('male')) {
    return { ...audience, genders: audience.genders.filter((g) => g !== 'male') };
  }
  if (presetId === 'female' && audience.genders.includes('female')) {
    return { ...audience, genders: audience.genders.filter((g) => g !== 'female') };
  }
  if (presetId === 'youth' && audience.ages.includes('youth')) {
    return { ...audience, ages: audience.ages.filter((a) => a !== 'youth') };
  }
  if (presetId === 'adult' && audience.ages.includes('adult')) {
    return { ...audience, ages: audience.ages.filter((a) => a !== 'adult') };
  }
  if (presetId === 'senior' && audience.ages.includes('senior')) {
    return { ...audience, ages: audience.ages.filter((a) => a !== 'senior') };
  }
  return preset.apply(audience);
}

function presetActive(audience: GreetingAudience, presetId: string): boolean {
  if (presetId === 'all') {
    return (
      !audience.locales.length &&
      !audience.roles.length &&
      !audience.nationalities.length &&
      !audience.genders.length &&
      !audience.ages.length
    );
  }
  if (presetId === 'ar') return audience.locales.includes('ar');
  if (presetId === 'en') return audience.locales.includes('en');
  if (presetId === 'tenant') return audience.roles.includes('tenant');
  if (presetId === 'owner') return audience.roles.includes('owner');
  if (presetId === 'staff') return audience.roles.includes('staff');
  if (presetId === 'omani') return audience.nationalities.some((n) => n.toUpperCase() === 'OM');
  if (presetId === 'expat') return audience.nationalities.some((n) => n.toUpperCase() === 'EXPAT');
  if (presetId === 'male') return audience.genders.includes('male');
  if (presetId === 'female') return audience.genders.includes('female');
  if (presetId === 'youth') return audience.ages.includes('youth');
  if (presetId === 'adult') return audience.ages.includes('adult');
  if (presetId === 'senior') return audience.ages.includes('senior');
  return false;
}

function statusLabel(status: GreetingCampaign['status'], ar: boolean): string {
  const map: Record<GreetingCampaign['status'], [string, string]> = {
    draft: ['مسودة', 'Draft'],
    scheduled: ['مجدولة', 'Scheduled'],
    sending: ['جارٍ الإرسال', 'Sending'],
    sent: ['أُرسلت', 'Sent'],
    cancelled: ['ملغاة', 'Cancelled'],
  };
  return ar ? map[status][0] : map[status][1];
}

/** Root-only desk: AI greeting cards, audience filters, preview, schedule / send. */
export function GreetingsAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [campaigns, setCampaigns] = useState<GreetingCampaign[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<GreetingAudienceEstimate | null>(null);
  const [changeRequest, setChangeRequest] = useState('');
  const [nationalityCode, setNationalityCode] = useState('');
  const [form, setForm] = useState({
    occasion: '',
    occasionDate: '',
    meaning: '',
    audience: emptyGreetingAudience(),
    scheduledAtLocal: '',
  });

  const selected = useMemo(
    () => campaigns?.find((c) => c.id === selectedId) ?? null,
    [campaigns, selectedId],
  );
  const design = selected ? currentDesign(selected) : null;

  const reload = useCallback(async () => {
    const data = await adminGet<{ campaigns: GreetingCampaign[] }>('/api/site-admin/greetings');
    setCampaigns(data.campaigns);
    return data.campaigns;
  }, []);

  useEffect(() => {
    let live = true;
    reload()
      .then((list) => {
        if (!live) return;
        if (list[0]) setSelectedId(list[0].id);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [reload]);

  useEffect(() => {
    if (!selected) {
      setEstimate(null);
      return;
    }
    setForm({
      occasion: selected.occasion,
      occasionDate: selected.occasionDate,
      meaning: selected.meaning,
      audience: selected.audience,
      scheduledAtLocal: selected.scheduledAt
        ? toLocalInput(selected.scheduledAt)
        : `${selected.occasionDate}T09:00`,
    });
    setChangeRequest('');
    let live = true;
    adminGet<{ campaign: GreetingCampaign; estimate: GreetingAudienceEstimate }>(
      `/api/site-admin/greetings/${selected.id}`,
    )
      .then((data) => {
        if (!live) return;
        setEstimate(data.estimate);
        setCampaigns((current) =>
          current
            ? current.map((c) => (c.id === data.campaign.id ? data.campaign : c))
            : [data.campaign],
        );
      })
      .catch(() => live && setEstimate(null));
    return () => {
      live = false;
    };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reload fields when selection changes

  async function createCampaign() {
    if (!form.occasion.trim() || !form.occasionDate) {
      setNotice({
        tone: 'error',
        text: ar ? 'أكمل اسم المناسبة والتاريخ.' : 'Fill the occasion name and date.',
      });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const data = await browserNextMutation<{
        campaign: GreetingCampaign;
        estimate: GreetingAudienceEstimate;
      }>('/api/site-admin/greetings', {
        method: 'POST',
        body: JSON.stringify({
          occasion: form.occasion.trim(),
          occasionDate: form.occasionDate,
          meaning: form.meaning.trim(),
          audience: form.audience,
          generateDesign: true,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      setCampaigns((current) => [data.campaign, ...(current ?? [])]);
      setSelectedId(data.campaign.id);
      setEstimate(data.estimate);
      setNotice({
        tone: 'success',
        text: ar ? 'أُنشئت الحملة وصُمّمت البطاقة.' : 'Campaign created and card designed.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الإنشاء.', 'Could not create.'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta() {
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = await browserNextMutation<{
        campaign: GreetingCampaign;
        estimate: GreetingAudienceEstimate;
      }>(`/api/site-admin/greetings/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          occasion: form.occasion.trim(),
          occasionDate: form.occasionDate,
          meaning: form.meaning.trim(),
          audience: form.audience,
        }),
      });
      setCampaigns((current) =>
        (current ?? []).map((c) => (c.id === data.campaign.id ? data.campaign : c)),
      );
      setEstimate(data.estimate);
      setNotice({ tone: 'success', text: ar ? 'حُفظت التعديلات.' : 'Saved.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الحفظ.', 'Could not save.'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function schedule() {
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    try {
      const iso = fromLocalInput(form.scheduledAtLocal || `${form.occasionDate}T09:00`);
      const data = await browserNextMutation<{
        campaign: GreetingCampaign;
        estimate: GreetingAudienceEstimate;
      }>(`/api/site-admin/greetings/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'scheduled', scheduledAt: iso }),
      });
      setCampaigns((current) =>
        (current ?? []).map((c) => (c.id === data.campaign.id ? data.campaign : c)),
      );
      setNotice({
        tone: 'success',
        text: ar ? 'جُدول الإرسال.' : 'Send scheduled.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الجدولة.', 'Could not schedule.'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    if (!selected) return;
    if (
      !window.confirm(
        ar
          ? `إرسال التهنئة الآن إلى حوالي ${estimate?.matched ?? '؟'} مستلم؟`
          : `Send this greeting now to about ${estimate?.matched ?? '?'} recipients?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const data = await browserNextMutation<{ campaign: GreetingCampaign; sent: number }>(
        `/api/site-admin/greetings/${selected.id}/send`,
        { method: 'POST', body: '{}' },
      );
      setCampaigns((current) =>
        (current ?? []).map((c) => (c.id === data.campaign.id ? data.campaign : c)),
      );
      setNotice({
        tone: 'success',
        text: ar ? `أُرسلت إلى ${data.sent} مستلم.` : `Sent to ${data.sent} recipients.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الإرسال.', 'Could not send.'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function redesign() {
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = await browserNextMutation<{ campaign: GreetingCampaign }>(
        `/api/site-admin/greetings/${selected.id}/design`,
        {
          method: 'POST',
          body: JSON.stringify({
            changeRequest: changeRequest.trim() || null,
          }),
          signal: AbortSignal.timeout(90_000),
        },
      );
      setCampaigns((current) =>
        (current ?? []).map((c) => (c.id === data.campaign.id ? data.campaign : c)),
      );
      setChangeRequest('');
      setNotice({
        tone: 'success',
        text: ar ? 'صُمّمت بطاقة جديدة (الصور السابقة محفوظة).' : 'New card designed (history kept).',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر إعادة التصميم.', 'Could not redesign.'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function restoreDesign(designId: string) {
    if (!selected) return;
    setBusy(true);
    try {
      const data = await browserNextMutation<{ campaign: GreetingCampaign }>(
        `/api/site-admin/greetings/${selected.id}/design`,
        {
          method: 'POST',
          body: JSON.stringify({ selectDesignId: designId }),
        },
      );
      setCampaigns((current) =>
        (current ?? []).map((c) => (c.id === data.campaign.id ? data.campaign : c)),
      );
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الاستعادة.', 'Could not restore.'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeCampaign(id: string) {
    if (!window.confirm(ar ? 'حذف هذه الحملة؟' : 'Delete this campaign?')) return;
    setBusy(true);
    try {
      await browserNextMutation(`/api/site-admin/greetings/${id}`, {
        method: 'DELETE',
        body: '{}',
      });
      setCampaigns((current) => (current ?? []).filter((c) => c.id !== id));
      setSelectedId((current) => (current === id ? null : current));
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الحذف.', 'Could not delete.'),
      });
    } finally {
      setBusy(false);
    }
  }

  if (failed) {
    return (
      <p className="notice notice--error" role="alert">
        {ar ? 'تعذّر تحميل حملات التهاني.' : 'Could not load greeting campaigns.'}
      </p>
    );
  }
  if (!campaigns) return <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>;

  return (
    <div className="sa-greetings">
      <header className="sa-section-head">
        <div>
          <h1>{ar ? 'التهاني والإشعارات المجدولة' : 'Scheduled greetings'}</h1>
          <p className="muted">
            {ar
              ? 'صف المناسبة والتاريخ والمعنى — يصمّم النظام بطاقة بالذكاء الاصطناعي مع شعار المنصة، ويعاينه ويرسله للفئة المستهدفة في الموعد.'
              : 'Describe the occasion, date and meaning — AI designs a branded card, you preview and iterate, then schedule or send to the audience.'}
          </p>
        </div>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            setSelectedId(null);
            setEstimate(null);
            setChangeRequest('');
            setForm({
              occasion: '',
              occasionDate: '',
              meaning: '',
              audience: emptyGreetingAudience(),
              scheduledAtLocal: '',
            });
          }}
        >
          {ar ? 'حملة جديدة' : 'New campaign'}
        </button>
      </header>

      {notice ? (
        <p className={`notice notice--${notice.tone}`} role="status">
          {notice.text}
        </p>
      ) : null}

      <div className="sa-greetings__grid">
        <aside className="sa-greetings__list">
          <h2>{ar ? 'الحملات' : 'Campaigns'}</h2>
          {campaigns.length === 0 ? (
            <p className="muted">{ar ? 'لا حملات بعد — أنشئ الأولى من النموذج.' : 'No campaigns yet.'}</p>
          ) : (
            <ul>
              {campaigns.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={c.id === selectedId ? 'is-active' : undefined}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <strong>{c.occasion}</strong>
                    <span>
                      {c.occasionDate} · {statusLabel(c.status, ar)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="sa-greetings__editor">
          <div className="sa-greetings__fields">
            <label>
              {ar ? 'المناسبة' : 'Occasion'}
              <input
                value={form.occasion}
                onChange={(e) => setForm({ ...form, occasion: e.target.value })}
                placeholder={ar ? 'مثال: العيد الوطني' : 'e.g. National Day'}
                maxLength={120}
              />
            </label>
            <label>
              {ar ? 'تاريخ المناسبة' : 'Occasion date'}
              <input
                type="date"
                value={form.occasionDate}
                onChange={(e) => setForm({ ...form, occasionDate: e.target.value })}
              />
            </label>
            <label className="sa-greetings__full">
              {ar ? 'ملاحظات للمناسبة (اختياري)' : 'Occasion notes (optional)'}
              <textarea
                value={form.meaning}
                onChange={(e) => setForm({ ...form, meaning: e.target.value })}
                rows={3}
                maxLength={800}
                placeholder={
                  ar
                    ? 'اتركه فارغاً ليصوغ الذكاء الاصطناعي نص التهنئة، أو اكتب توجيهات قصيرة…'
                    : 'Leave blank for AI ceremonial copy, or add short guidance…'
                }
              />
            </label>
          </div>

          <fieldset className="sa-greetings__audience">
            <legend>{ar ? 'الفئة المستهدفة' : 'Audience'}</legend>
            <div className="sa-greetings__chips">
              {GREETING_AUDIENCE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={presetActive(form.audience, preset.id) ? 'is-active' : undefined}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      audience: togglePreset(current.audience, preset.id),
                    }))
                  }
                >
                  {ar ? preset.ar : preset.en}
                </button>
              ))}
            </div>
            <label className="sa-greetings__nat">
              {ar ? 'جنسية محددة (رمز ISO)' : 'Specific nationality (ISO)'}
              <span>
                <input
                  value={nationalityCode}
                  onChange={(e) => setNationalityCode(e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="IN"
                  maxLength={2}
                />
                <button
                  type="button"
                  disabled={nationalityCode.length !== 2}
                  onClick={() => {
                    const code = nationalityCode.toUpperCase();
                    setForm((current) => ({
                      ...current,
                      audience: {
                        ...current.audience,
                        nationalities: [...new Set([...current.audience.nationalities, code])],
                      },
                    }));
                    setNationalityCode('');
                  }}
                >
                  {ar ? 'إضافة' : 'Add'}
                </button>
              </span>
            </label>
            <p className="muted">
              {ar ? 'المحدّد الآن: ' : 'Selected: '}
              <strong>{audienceSummary(form.audience, ar)}</strong>
              {estimate ? (
                <>
                  {' '}
                  · {ar ? 'مستلمون متوقعون:' : 'matched:'} <strong>{estimate.matched}</strong>
                </>
              ) : null}
            </p>
            <p className="muted sa-greetings__hint">
              {ar
                ? 'الجنس والعمر والجنسية تُطبَّق عند توفرها في ملف الطرف المرتبط بالحساب؛ وإلا يُستبعد المستلم من هذا الفلتر.'
                : 'Gender, age and nationality apply when present on the linked party profile; otherwise that recipient is excluded from those filters.'}
            </p>
          </fieldset>

          <div className="sa-greetings__actions">
            {!selected || selected.status === 'sent' ? (
              <button
                type="button"
                className="button button--primary"
                disabled={busy}
                onClick={() => void createCampaign()}
              >
                {busy
                  ? ar
                    ? 'جارٍ رسم الصورة…'
                    : 'Rendering image…'
                  : ar
                    ? 'إنشاء ورسم صورة التهنئة'
                    : 'Create & render AI image'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button"
                  disabled={busy || selected.status === 'sending'}
                  onClick={() => void saveMeta()}
                >
                  {ar ? 'حفظ التعديلات' : 'Save changes'}
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy || !design || selected.status === 'sending'}
                  onClick={() => void sendNow()}
                >
                  {ar ? 'إرسال الآن' : 'Send now'}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy || !design || selected.status === 'sending'}
                  onClick={() => void schedule()}
                >
                  {ar ? 'جدولة الإرسال' : 'Schedule send'}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busy}
                  onClick={() => void removeCampaign(selected.id)}
                >
                  {ar ? 'حذف' : 'Delete'}
                </button>
              </>
            )}
          </div>

          {selected && selected.status !== 'sent' ? (
            <label>
              {ar ? 'وقت الإرسال المجدول' : 'Scheduled send time'}
              <input
                type="datetime-local"
                value={form.scheduledAtLocal}
                onChange={(e) => setForm({ ...form, scheduledAtLocal: e.target.value })}
              />
            </label>
          ) : null}

          {selected && design ? (
            <div className="sa-greetings__preview">
              <h2>{ar ? 'معاينة الصورة الرقمية' : 'Digital image preview'}</h2>
              {!design.imageBase64 ? (
                <p className="notice notice--error" role="alert">
                  {ar
                    ? 'هذا التصميم قديم (نص فقط). اضغط «إعادة رسم الصورة» لتوليد صورة بالذكاء الاصطناعي.'
                    : 'This is a legacy text-only design. Click “AI re-render image” for a photorealistic card.'}
                </p>
              ) : null}
              <div className="sa-greetings__frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={design.id}
                  src={designPreviewSrc(selected.id, design)}
                  alt={design.headlineAr}
                />
              </div>
              <div className="sa-greetings__copy">
                <h3>{ar ? 'النص الذي صاغه الذكاء الاصطناعي' : 'AI ceremonial copy'}</h3>
                <p>
                  <strong>{design.headlineAr}</strong>
                </p>
                <p>{design.bodyAr}</p>
                <p className="muted" dir="ltr">
                  {design.headlineEn} — {design.bodyEn}
                </p>
              </div>
              <p className="muted">
                {design.motif}
                {selected.scheduledAt
                  ? ` · ${ar ? 'مجدول' : 'scheduled'} ${adminDate(selected.scheduledAt, ar)}`
                  : null}
                {selected.sentAt
                  ? ` · ${ar ? 'أُرسل' : 'sent'} ${adminDate(selected.sentAt, ar)} (${selected.sentCount})`
                  : null}
              </p>
              <label className="sa-greetings__full">
                {ar ? 'طلب تغيير على التصميم' : 'Change request for redesign'}
                <textarea
                  value={changeRequest}
                  onChange={(e) => setChangeRequest(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder={
                    ar
                      ? 'مثال: مزيد من الشباب، قلعة نزوى أوضح، إضاءة صباحية… (النص والعلم يُركَّبان تلقائياً)'
                      : 'e.g. more youth, clearer Nizwa fort, morning light… (Arabic text & Oman flag are composited)'
                  }
                />
              </label>
              <button
                type="button"
                className="button button--primary"
                disabled={busy || selected.status === 'sending'}
                onClick={() => void redesign()}
              >
                {busy
                  ? ar
                    ? 'جارٍ رسم صورة جديدة…'
                    : 'Rendering new image…'
                  : ar
                    ? 'إعادة رسم الصورة بالذكاء الاصطناعي'
                    : 'AI re-render image'}
              </button>

              {selected.designs.length > 1 ? (
                <div className="sa-greetings__history">
                  <h3>{ar ? 'سجل التصاميم السابقة' : 'Previous designs'}</h3>
                  <ul>
                    {selected.designs.map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          className={d.id === design.id ? 'is-active' : undefined}
                          disabled={busy}
                          onClick={() => void restoreDesign(d.id)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={designPreviewSrc(selected.id, d)} alt="" />
                          <span>{adminDate(d.createdAt, ar)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  // Display in Muscat (UTC+4) for the admin.
  const muscat = new Date(date.getTime() + 4 * 3600_000);
  return `${muscat.getUTCFullYear()}-${pad(muscat.getUTCMonth() + 1)}-${pad(muscat.getUTCDate())}T${pad(muscat.getUTCHours())}:${pad(muscat.getUTCMinutes())}`;
}

function fromLocalInput(value: string): string {
  // Treat datetime-local as Muscat wall time.
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return new Date(value).toISOString();
  const [, y, mo, d, h, mi] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 4, Number(mi))).toISOString();
}
