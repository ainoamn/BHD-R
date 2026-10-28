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
  return (
    campaign.designs.find((d) => d.id === campaign.currentDesignId) ?? campaign.designs[0] ?? null
  );
}

function designPreviewSrc(campaignId: string, design: GreetingDesignVersion): string {
  return `/api/public/greeting-card/${campaignId}/${design.id}?v=${encodeURIComponent(design.createdAt)}`;
}

function togglePreset(audience: GreetingAudience, presetId: string): GreetingAudience {
  if (presetId === 'all') return emptyGreetingAudience();
  const preset = GREETING_AUDIENCE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return audience;
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

function readFileAsBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const match = result.match(/^data:([^;]+);base64,(.+)$/);
      if (!match?.[1] || !match[2]) {
        reject(new Error('invalid_image'));
        return;
      }
      resolve({ mime: match[1], base64: match[2] });
    };
    reader.readAsDataURL(file);
  });
}

/** Root-only desk: manual greeting cards, audience, email/WhatsApp preview, schedule / send. */
export function GreetingsAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [campaigns, setCampaigns] = useState<GreetingCampaign[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<GreetingAudienceEstimate | null>(null);
  const [previewChannel, setPreviewChannel] = useState<'email' | 'whatsapp'>('email');
  const [previewLocale, setPreviewLocale] = useState<'ar' | 'en'>('ar');
  const [nationalityCode, setNationalityCode] = useState('');
  const [pendingImage, setPendingImage] = useState<{
    base64: string;
    mime: string;
    name: string;
    previewUrl: string;
  } | null>(null);
  const [form, setForm] = useState({
    occasion: '',
    occasionDate: '',
    meaning: '',
    audience: emptyGreetingAudience(),
    scheduledAtLocal: '',
    headlineAr: '',
    headlineEn: '',
    bodyAr: '',
    bodyEn: '',
  });

  const selected = useMemo(
    () => campaigns?.find((c) => c.id === selectedId) ?? null,
    [campaigns, selectedId],
  );
  const design = selected ? currentDesign(selected) : null;
  const locked = selected?.status === 'sending' || selected?.status === 'sent';

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
    const d = currentDesign(selected);
    setForm({
      occasion: selected.occasion,
      occasionDate: selected.occasionDate,
      meaning: selected.meaning,
      audience: selected.audience,
      scheduledAtLocal: selected.scheduledAt
        ? toLocalInput(selected.scheduledAt)
        : `${selected.occasionDate}T09:00`,
      headlineAr: d?.headlineAr ?? '',
      headlineEn: d?.headlineEn ?? '',
      bodyAr: d?.bodyAr ?? '',
      bodyEn: d?.bodyEn ?? '',
    });
    setPendingImage(null);
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
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reload when selection changes

  useEffect(() => {
    return () => {
      if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    };
  }, [pendingImage?.previewUrl]);

  function resetNewForm() {
    setSelectedId(null);
    setEstimate(null);
    setPendingImage(null);
    setForm({
      occasion: '',
      occasionDate: '',
      meaning: '',
      audience: emptyGreetingAudience(),
      scheduledAtLocal: '',
      headlineAr: '',
      headlineEn: '',
      bodyAr: '',
      bodyEn: '',
    });
  }

  async function onPickImage(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotice({
        tone: 'error',
        text: ar ? 'اختر صورة JPEG أو PNG أو WebP.' : 'Choose a JPEG, PNG or WebP image.',
      });
      return;
    }
    if (file.size > 2_500_000) {
      setNotice({
        tone: 'error',
        text: ar ? 'الصورة أكبر من 2.5 ميغابايت.' : 'Image larger than 2.5 MB.',
      });
      return;
    }
    try {
      const { base64, mime } = await readFileAsBase64(file);
      if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
      setPendingImage({
        base64,
        mime,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
      });
    } catch {
      setNotice({
        tone: 'error',
        text: ar ? 'تعذّر قراءة الصورة.' : 'Could not read the image.',
      });
    }
  }

  async function createCampaign() {
    if (!form.occasion.trim() || !form.occasionDate) {
      setNotice({
        tone: 'error',
        text: ar ? 'أكمل اسم المناسبة والتاريخ.' : 'Fill the occasion name and date.',
      });
      return;
    }
    if (!form.headlineAr.trim() || !form.bodyAr.trim() || !pendingImage) {
      setNotice({
        tone: 'error',
        text: ar
          ? 'أدخل العنوان والنص بالعربية وارفع صورة البطاقة.'
          : 'Enter Arabic headline & body and upload a card image.',
      });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const created = await browserNextMutation<{
        campaign: GreetingCampaign;
        estimate: GreetingAudienceEstimate;
      }>('/api/site-admin/greetings', {
        method: 'POST',
        body: JSON.stringify({
          occasion: form.occasion.trim(),
          occasionDate: form.occasionDate,
          meaning: form.meaning.trim(),
          audience: form.audience,
          generateDesign: false,
        }),
      });
      const uploaded = await browserNextMutation<{ campaign: GreetingCampaign }>(
        `/api/site-admin/greetings/${created.campaign.id}/design`,
        {
          method: 'POST',
          body: JSON.stringify({
            upload: {
              headlineAr: form.headlineAr.trim(),
              headlineEn: form.headlineEn.trim() || form.headlineAr.trim(),
              bodyAr: form.bodyAr.trim(),
              bodyEn: form.bodyEn.trim() || form.bodyAr.trim(),
              imageBase64: pendingImage.base64,
              imageMime: pendingImage.mime,
            },
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      setCampaigns((current) => [uploaded.campaign, ...(current ?? [])]);
      setSelectedId(uploaded.campaign.id);
      setEstimate(created.estimate);
      setPendingImage(null);
      setNotice({
        tone: 'success',
        text: ar ? 'أُنشئت الحملة وحُفظت الصورة.' : 'Campaign created with your image.',
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
    if (!selected || locked) return;
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
          design: design
            ? {
                headlineAr: form.headlineAr.trim(),
                headlineEn: form.headlineEn.trim() || form.headlineAr.trim(),
                bodyAr: form.bodyAr.trim(),
                bodyEn: form.bodyEn.trim() || form.bodyAr.trim(),
              }
            : undefined,
        }),
      });
      let campaign = data.campaign;
      if (pendingImage) {
        const uploaded = await browserNextMutation<{ campaign: GreetingCampaign }>(
          `/api/site-admin/greetings/${selected.id}/design`,
          {
            method: 'POST',
            body: JSON.stringify({
              upload: {
                headlineAr: form.headlineAr.trim(),
                headlineEn: form.headlineEn.trim() || form.headlineAr.trim(),
                bodyAr: form.bodyAr.trim(),
                bodyEn: form.bodyEn.trim() || form.bodyAr.trim(),
                imageBase64: pendingImage.base64,
                imageMime: pendingImage.mime,
                replaceCurrent: Boolean(design),
              },
            }),
            signal: AbortSignal.timeout(60_000),
          },
        );
        campaign = uploaded.campaign;
        setPendingImage(null);
      }
      setCampaigns((current) => (current ?? []).map((c) => (c.id === campaign.id ? campaign : c)));
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
    if (!selected || !design) return;
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
      setNotice({ tone: 'success', text: ar ? 'جُدول الإرسال.' : 'Send scheduled.' });
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
    if (!selected || !design) return;
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

  async function restoreDesign(designId: string) {
    if (!selected || locked) return;
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
      setNotice({ tone: 'success', text: ar ? 'حُذفت الحملة.' : 'Campaign deleted.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الحذف.', 'Could not delete.'),
      });
    } finally {
      setBusy(false);
    }
  }

  const previewHeadline =
    previewLocale === 'ar'
      ? form.headlineAr || design?.headlineAr || ''
      : form.headlineEn || design?.headlineEn || form.headlineAr || '';
  const previewBody =
    previewLocale === 'ar'
      ? form.bodyAr || design?.bodyAr || ''
      : form.bodyEn || design?.bodyEn || form.bodyAr || '';
  const previewImage =
    pendingImage?.previewUrl || (selected && design ? designPreviewSrc(selected.id, design) : null);
  const whatsappCaption = [
    previewHeadline ? `*${previewHeadline}*` : '',
    previewBody,
    form.occasion ? `${form.occasion}${form.occasionDate ? ` · ${form.occasionDate}` : ''}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

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
          <h1>{ar ? 'التهاني والإشعارات' : 'Greetings & notices'}</h1>
          <p className="muted">
            {ar
              ? 'ارفع صورة البطاقة واكتب النص بنفسك، عاين كيف يظهر في البريد وواتساب، ثم أرسل أو جدول للفئة المستهدفة.'
              : 'Upload the card image and write the copy yourself, preview email and WhatsApp, then send or schedule to the audience.'}
          </p>
        </div>
        <button type="button" className="button" disabled={busy} onClick={resetNewForm}>
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
            <p className="muted">{ar ? 'لا حملات بعد.' : 'No campaigns yet.'}</p>
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
                disabled={locked}
              />
            </label>
            <label>
              {ar ? 'تاريخ المناسبة' : 'Occasion date'}
              <input
                type="date"
                value={form.occasionDate}
                onChange={(e) => setForm({ ...form, occasionDate: e.target.value })}
                disabled={locked}
              />
            </label>
            <label className="sa-greetings__full">
              {ar ? 'ملاحظة قصيرة تحت البطاقة (اختياري)' : 'Short note under the card (optional)'}
              <textarea
                value={form.meaning}
                onChange={(e) => setForm({ ...form, meaning: e.target.value })}
                rows={2}
                maxLength={800}
                disabled={locked}
              />
            </label>
            <label>
              {ar ? 'العنوان (عربي)' : 'Headline (Arabic)'}
              <input
                value={form.headlineAr}
                onChange={(e) => setForm({ ...form, headlineAr: e.target.value })}
                maxLength={160}
                disabled={locked}
              />
            </label>
            <label>
              {ar ? 'العنوان (إنجليزي)' : 'Headline (English)'}
              <input
                value={form.headlineEn}
                onChange={(e) => setForm({ ...form, headlineEn: e.target.value })}
                maxLength={160}
                disabled={locked}
                dir="ltr"
              />
            </label>
            <label className="sa-greetings__full">
              {ar ? 'نص الرسالة (عربي)' : 'Message body (Arabic)'}
              <textarea
                value={form.bodyAr}
                onChange={(e) => setForm({ ...form, bodyAr: e.target.value })}
                rows={3}
                maxLength={800}
                disabled={locked}
              />
            </label>
            <label className="sa-greetings__full">
              {ar ? 'نص الرسالة (إنجليزي)' : 'Message body (English)'}
              <textarea
                value={form.bodyEn}
                onChange={(e) => setForm({ ...form, bodyEn: e.target.value })}
                rows={3}
                maxLength={800}
                disabled={locked}
                dir="ltr"
              />
            </label>
            <label className="sa-greetings__full">
              {ar ? 'صورة البطاقة / التنبيه' : 'Card / notice image'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={locked || busy}
                onChange={(e) => void onPickImage(e.target.files?.[0] ?? null)}
              />
              <span className="muted">
                {ar
                  ? 'JPEG / PNG / WebP · حتى نحو 2.5 ميغابايت — تُضغط تلقائياً عند الحفظ.'
                  : 'JPEG / PNG / WebP · up to ~2.5 MB — compressed on save.'}
              </span>
            </label>
          </div>

          <fieldset className="sa-greetings__audience">
            <legend>{ar ? 'الفئة المستهدفة' : 'Audience'}</legend>
            <div className="sa-greetings__chips">
              {GREETING_AUDIENCE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={locked}
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
                  disabled={locked}
                />
                <button
                  type="button"
                  disabled={locked || nationalityCode.length !== 2}
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
                    ? 'جارٍ الحفظ…'
                    : 'Saving…'
                  : ar
                    ? 'إنشاء الحملة وحفظ الصورة'
                    : 'Create campaign & save image'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button"
                  disabled={busy || locked}
                  onClick={() => void saveMeta()}
                >
                  {ar ? 'حفظ التعديلات' : 'Save changes'}
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy || !design || locked}
                  onClick={() => void sendNow()}
                >
                  {ar ? 'إرسال الآن' : 'Send now'}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy || !design || locked}
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

          {selected && !locked ? (
            <label>
              {ar ? 'وقت الإرسال المجدول' : 'Scheduled send time'}
              <input
                type="datetime-local"
                value={form.scheduledAtLocal}
                onChange={(e) => setForm({ ...form, scheduledAtLocal: e.target.value })}
              />
            </label>
          ) : null}

          <div className="sa-greetings__preview">
            <div className="sa-greetings__preview-tabs">
              <h2>{ar ? 'معاينة الظهور' : 'Appearance preview'}</h2>
              <div className="sa-greetings__chips" role="tablist">
                <button
                  type="button"
                  className={previewChannel === 'email' ? 'is-active' : undefined}
                  onClick={() => setPreviewChannel('email')}
                >
                  {ar ? 'البريد' : 'Email'}
                </button>
                <button
                  type="button"
                  className={previewChannel === 'whatsapp' ? 'is-active' : undefined}
                  onClick={() => setPreviewChannel('whatsapp')}
                >
                  {ar ? 'واتساب' : 'WhatsApp'}
                </button>
                <button
                  type="button"
                  className={previewLocale === 'ar' ? 'is-active' : undefined}
                  onClick={() => setPreviewLocale('ar')}
                >
                  العربية
                </button>
                <button
                  type="button"
                  className={previewLocale === 'en' ? 'is-active' : undefined}
                  onClick={() => setPreviewLocale('en')}
                >
                  English
                </button>
              </div>
            </div>

            {previewChannel === 'email' ? (
              <article
                className="sa-greetings__email"
                dir={previewLocale === 'ar' ? 'rtl' : 'ltr'}
                lang={previewLocale}
              >
                <header>
                  <span className="sa-greetings__email-from">BHD R</span>
                  <strong>
                    {previewHeadline
                      ? `${previewHeadline} · ${form.occasion || '…'}`
                      : form.occasion || (ar ? 'موضوع الرسالة' : 'Subject')}
                  </strong>
                </header>
                <p className="sa-greetings__email-hello">
                  {previewLocale === 'ar' ? 'مرحباً بك،' : 'Hello,'}
                </p>
                {previewImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewImage} alt="" className="sa-greetings__email-hero" />
                ) : (
                  <div className="sa-greetings__email-hero sa-greetings__email-hero--empty">
                    {ar ? 'ارفع صورة لترى المعاينة' : 'Upload an image to preview'}
                  </div>
                )}
                <h3>{previewHeadline || '—'}</h3>
                <p>{previewBody || '—'}</p>
                {form.meaning ? <p className="muted">{form.meaning}</p> : null}
                <p className="sa-greetings__email-meta">
                  {(form.occasion || '—') + (form.occasionDate ? ` · ${form.occasionDate}` : '')}
                </p>
              </article>
            ) : (
              <div className="sa-greetings__wa" dir={previewLocale === 'ar' ? 'rtl' : 'ltr'}>
                <div className="sa-greetings__wa-bubble">
                  {previewImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewImage} alt="" />
                  ) : (
                    <div className="sa-greetings__wa-empty">
                      {ar ? 'لا صورة بعد' : 'No image yet'}
                    </div>
                  )}
                  <pre>{whatsappCaption || (ar ? 'نص الرسالة…' : 'Message…')}</pre>
                </div>
                <p className="muted">
                  {ar
                    ? 'معاينة شكل رسالة واتساب (صورة + نص). الإرسال الحالي عبر البريد الإلكتروني للطابور.'
                    : 'WhatsApp-style preview (image + caption). Current dispatch queues email.'}
                </p>
              </div>
            )}

            {selected && design && selected.designs.length > 1 ? (
              <div className="sa-greetings__history">
                <h3>{ar ? 'إصدارات الصورة' : 'Image versions'}</h3>
                <ul>
                  {selected.designs.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className={d.id === design.id ? 'is-active' : undefined}
                        disabled={busy || locked}
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

            {selected?.sentAt ? (
              <p className="muted">
                {ar ? 'أُرسل' : 'Sent'} {adminDate(selected.sentAt, ar)} ({selected.sentCount})
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const muscat = new Date(date.getTime() + 4 * 3600_000);
  return `${muscat.getUTCFullYear()}-${pad(muscat.getUTCMonth() + 1)}-${pad(muscat.getUTCDate())}T${pad(muscat.getUTCHours())}:${pad(muscat.getUTCMinutes())}`;
}

function fromLocalInput(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return new Date(value).toISOString();
  const [, y, mo, d, h, mi] = m;
  return new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 4, Number(mi)),
  ).toISOString();
}
