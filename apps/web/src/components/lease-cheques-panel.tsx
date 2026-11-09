'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { DocFileThumb } from '@/components/doc-file-thumb';
import { DocStatusMark, docStatusLabel } from '@/components/doc-status-mark';
import { FilePreviewDialog, type PreviewFile } from '@/components/file-preview';
import { UploadPrepareDialog } from '@/components/upload-prepare-dialog';
import { ApiError, browserNextMutation } from '@/lib/api';
import { compressImageFile } from '@/lib/compress-image';
import { formatMoney } from '@/lib/format';
import type { LeaseJourneyProps } from '@/lib/lease-journey-screens';
import {
  REQUIREMENT_FILE_MAX_CHARS,
  bookingUploadFileSlots,
  otherSlotUsingUploadFileName,
} from '@/lib/lease-reservation-lifecycle';
import { OMAN_BANKS } from '@/lib/stay-deposit-refund';

const BANK_OTHER = '__other__';
type ChequeViewMode = 'table' | 'step' | 'bulk';

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read_failed'));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

function errorText(error: unknown, ar: boolean): string {
  if (error instanceof ApiError) return error.message;
  return ar ? 'تعذّر الإرسال — تحقق من الاتصال وأعد المحاولة.' : 'Could not send — try again.';
}

/** Fill following cheque numbers from a starting value (keeps prefix/suffix and zero-padding). */
function sequenceChequeNumbers(start: string, count: number): string[] {
  const trimmed = start.trim();
  if (!trimmed || count <= 0) return Array.from({ length: count }, () => '');
  const match = trimmed.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) {
    return Array.from({ length: count }, (_, index) => (index === 0 ? trimmed : ''));
  }
  const prefix = match[1] ?? '';
  const digits = match[2] ?? '0';
  const suffix = match[3] ?? '';
  const width = digits.length;
  let value = BigInt(digits);
  return Array.from({ length: count }, () => {
    const next = `${prefix}${value.toString().padStart(width, '0')}${suffix}`;
    value += 1n;
    return next;
  });
}

/**
 * Tenant cheque uploads on the booking confirmed journey.
 * Three modes: table (one-by-one), step wizard, or one multi-cheque scan assigned to months.
 */
export function LeaseCheques({
  lifecycle,
  locale,
  referenceCode,
  readOnly = false,
}: LeaseJourneyProps & { readOnly?: boolean }) {
  const ar = locale === 'ar';
  const router = useRouter();
  const cheques = lifecycle.cheques ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const [pending, setPending] = useState<{ key: string; file: File } | null>(null);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [viewMode, setViewMode] = useState<ChequeViewMode | ''>('');
  const [stepIndex, setStepIndex] = useState(0);
  const [bulkMaster, setBulkMaster] = useState<File | null>(null);
  const [bulkMasterUrl, setBulkMasterUrl] = useState<string | null>(null);
  const [bulkAssignKey, setBulkAssignKey] = useState<string | null>(null);
  const [bulkCrops, setBulkCrops] = useState<Record<string, File>>({});
  const [bulkSending, setBulkSending] = useState(false);

  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error, errorKey]);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(`bhd-cheque-view:${referenceCode}`);
      if (stored === 'table' || stored === 'step' || stored === 'bulk') setViewMode(stored);
      else setViewMode('');
    } catch {
      /* private mode */
    }
  }, [referenceCode]);

  useEffect(() => {
    if (!bulkMaster) {
      setBulkMasterUrl(null);
      return;
    }
    const url = URL.createObjectURL(bulkMaster);
    setBulkMasterUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bulkMaster]);

  const seededShared = (() => {
    const withBank = cheques.find((item) => item.bankName?.trim());
    const withHolder = cheques.find((item) => item.accountHolderName?.trim());
    const withAccount = cheques.find((item) => item.accountNumber?.trim());
    return {
      bankName: withBank?.bankName?.trim() ?? '',
      accountHolderName: withHolder?.accountHolderName?.trim() ?? '',
      accountNumber: withAccount?.accountNumber?.trim() ?? '',
    };
  })();
  const [bankName, setBankName] = useState(seededShared.bankName);
  const [bankOther, setBankOther] = useState(
    () => Boolean(seededShared.bankName) && !OMAN_BANKS.includes(seededShared.bankName),
  );
  const [accountHolderName, setAccountHolderName] = useState(seededShared.accountHolderName);
  const [accountNumber, setAccountNumber] = useState(seededShared.accountNumber);
  const bankSelectValue = bankOther ? BANK_OTHER : OMAN_BANKS.includes(bankName) ? bankName : '';
  const [numbers, setNumbers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    const seeded = cheques.map((item) => item.chequeNumber ?? item.suggestedChequeNumber ?? '');
    const first = seeded.find((value) => value.trim()) ?? '';
    const sequenced = first ? sequenceChequeNumbers(first, cheques.length) : seeded;
    cheques.forEach((item, index) => {
      const existing = item.chequeNumber?.trim();
      initial[item.key] = existing || sequenced[index] || seeded[index] || '';
    });
    return initial;
  });

  const actionQueue = useMemo(
    () => cheques.filter((item) => item.status === 'pending' || item.status === 'rejected'),
    [cheques],
  );
  const stepItem = actionQueue.length
    ? actionQueue[Math.min(stepIndex, actionQueue.length - 1)]!
    : null;
  const bulkQueue = actionQueue;
  const bulkAssignItem = bulkAssignKey
    ? (cheques.find((item) => item.key === bulkAssignKey) ?? null)
    : null;

  if (!cheques.length) return null;

  function chooseMode(mode: ChequeViewMode | '') {
    setViewMode(mode);
    setError(null);
    setErrorKey(null);
    try {
      if (mode) sessionStorage.setItem(`bhd-cheque-view:${referenceCode}`, mode);
      else sessionStorage.removeItem(`bhd-cheque-view:${referenceCode}`);
    } catch {
      /* ignore */
    }
  }

  function flagChequeProblem(message: string, key: string) {
    setErrorKey(key);
    setError(message);
    window.alert(message);
  }

  function sharedBankReady(): boolean {
    return (
      bankName.trim().length >= 2 &&
      accountHolderName.trim().length >= 2 &&
      accountNumber.trim().replace(/\s+/g, '').length >= 4
    );
  }

  function duplicateChequeNumber(key: string, value: string): string | null {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    for (const item of cheques) {
      if (item.key === key) continue;
      const other = (numbers[item.key] ?? item.chequeNumber ?? '').trim().toLowerCase();
      if (other && other === normalized) {
        return ar ? item.labelAr : item.labelEn || item.labelAr;
      }
    }
    return null;
  }

  function applySequenceFrom(index: number, value: string) {
    setNumbers((current) => {
      const next = { ...current };
      const keys = cheques.slice(index).map((item) => item.key);
      const sequenced = sequenceChequeNumbers(value, keys.length);
      keys.forEach((key, offset) => {
        const row = cheques[index + offset];
        if (!row || row.status === 'approved') return;
        next[key] = sequenced[offset] ?? '';
      });
      return next;
    });
  }

  function assertReadyToPick(key: string, file: File): boolean {
    if (!sharedBankReady()) {
      flagChequeProblem(
        ar
          ? 'أدخل البنك واسم صاحب الحساب ورقم الحساب مرة واحدة أعلى الجدول قبل رفع الصور.'
          : 'Enter bank, account holder, and account number once above the table before uploading photos.',
        key,
      );
      return false;
    }
    const chequeNumber = (numbers[key] ?? '').trim();
    if (!chequeNumber) {
      flagChequeProblem(
        ar
          ? 'أدخل رقم الشيك قبل رفع الصورة.'
          : 'Enter the cheque number before uploading the photo.',
        key,
      );
      return false;
    }
    const numberClash = duplicateChequeNumber(key, chequeNumber);
    if (numberClash) {
      flagChequeProblem(
        ar
          ? `رقم الشيك «${chequeNumber}» مكرر مع «${numberClash}» — استبدله برقم مختلف قبل الرفع.`
          : `Cheque number “${chequeNumber}” is already used on “${numberClash}” — replace it with a different number before uploading.`,
        key,
      );
      return false;
    }
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
      flagChequeProblem(ar ? 'أرسل صورة أو ملف PDF.' : 'Send an image or a PDF.', key);
      return false;
    }
    const duplicate = otherSlotUsingUploadFileName(
      file.name,
      bookingUploadFileSlots({
        requirements: lifecycle.requirements,
        cheques: lifecycle.cheques,
      }),
      `cheque:${key}`,
    );
    if (duplicate) {
      flagChequeProblem(
        ar
          ? `صورة الشيك مكررة: الملف «${duplicate}» مرفوع في حقل آخر — استبدله بصورة شيك مختلفة.`
          : `Duplicate cheque photo: “${duplicate}” is already attached elsewhere — replace it with a different cheque image.`,
        key,
      );
      return false;
    }
    return true;
  }

  function pick(key: string, event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    if (!assertReadyToPick(key, picked)) return;
    setError(null);
    setErrorKey(null);
    setPending({ key, file: picked });
  }

  async function send(key: string, prepared: File, options?: { skipRefresh?: boolean }) {
    setBusy(key);
    setPending(null);
    const chequeNumber = (numbers[key] ?? '').trim();
    const numberClash = duplicateChequeNumber(key, chequeNumber);
    if (numberClash) {
      flagChequeProblem(
        ar
          ? `رقم الشيك «${chequeNumber}» مكرر مع «${numberClash}» — استبدله برقم مختلف.`
          : `Cheque number “${chequeNumber}” is already used on “${numberClash}” — replace it.`,
        key,
      );
      setBusy(null);
      return false;
    }
    const uniqueName =
      prepared.name.trim() ||
      `cheque-${key}.${prepared.type === 'application/pdf' ? 'pdf' : 'jpg'}`;
    const duplicate = otherSlotUsingUploadFileName(
      uniqueName,
      bookingUploadFileSlots({
        requirements: lifecycle.requirements,
        cheques: lifecycle.cheques,
      }),
      `cheque:${key}`,
    );
    if (duplicate) {
      flagChequeProblem(
        ar
          ? `صورة الشيك مكررة: الملف «${duplicate}» مرفوع في حقل آخر — استبدله بصورة شيك مختلفة.`
          : `Duplicate cheque photo: “${duplicate}” is already attached elsewhere — replace it with a different cheque image.`,
        key,
      );
      setBusy(null);
      return false;
    }
    try {
      const file = prepared.type.startsWith('image/')
        ? await compressImageFile(prepared)
        : prepared;
      const dataUrl = await readAsDataUrl(file);
      if (dataUrl.length > REQUIREMENT_FILE_MAX_CHARS) {
        flagChequeProblem(
          ar
            ? 'الملف كبير جداً (الحد نحو 1 ميغابايت). صوّره بدقة أقل.'
            : 'The file is too large (about 1 MB max).',
          key,
        );
        return false;
      }
      await browserNextMutation(
        `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/cheques`,
        {
          method: 'POST',
          body: JSON.stringify({
            key,
            bankName: bankName.trim(),
            accountHolderName: accountHolderName.trim(),
            accountNumber: accountNumber.trim().replace(/\s+/g, ''),
            chequeNumber,
            fileName: uniqueName.slice(0, 200),
            dataUrl,
          }),
        },
      );
      setError(null);
      setErrorKey(null);
      if (!options?.skipRefresh) router.refresh();
      return true;
    } catch (caught) {
      flagChequeProblem(
        caught instanceof ApiError ? errorText(caught, ar) : (caught as Error).message,
        key,
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function sendAndAdvance(key: string, prepared: File) {
    // After refresh the uploaded row leaves the queue, so the same step index becomes the next cheque.
    await send(key, prepared);
  }

  function pickBulkMaster(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    if (!picked.type.startsWith('image/') && picked.type !== 'application/pdf') {
      flagChequeProblem(ar ? 'أرسل صورة أو ملف PDF للمسح.' : 'Send an image or PDF scan.', 'bulk');
      return;
    }
    if (picked.type === 'application/pdf') {
      flagChequeProblem(
        ar
          ? 'للمسح الجماعي استخدم صورة واحدة تجمع الشيكات (سكان)، ثم قصّ كل شيك لشهره. ملف PDF يُرفع في الوضع العادي شيكاً بشيك.'
          : 'For the multi-cheque scan use one photo of all cheques, then crop each cheque to its month. Upload PDFs one cheque at a time in the normal modes.',
        'bulk',
      );
      return;
    }
    if (!sharedBankReady()) {
      flagChequeProblem(
        ar
          ? 'أدخل البنك واسم صاحب الحساب ورقم الحساب أولاً.'
          : 'Enter bank, account holder, and account number first.',
        'bulk',
      );
      return;
    }
    setBulkMaster(picked);
    setBulkCrops({});
    setBulkAssignKey(null);
    setError(null);
    setErrorKey(null);
  }

  function startBulkCrop(key: string) {
    if (!bulkMaster) return;
    if (!assertReadyToPick(key, bulkMaster)) return;
    setBulkAssignKey(key);
  }

  function confirmBulkCrop(file: File) {
    if (!bulkAssignKey) return;
    const key = bulkAssignKey;
    const named = new File([file], `cheque-${key}-${Date.now()}.jpg`, {
      type: file.type || 'image/jpeg',
    });
    setBulkCrops((current) => {
      const next = { ...current, [key]: named };
      const nextPending = bulkQueue.find((item) => item.key !== key && !next[item.key]);
      queueMicrotask(() => setBulkAssignKey(nextPending?.key ?? null));
      return next;
    });
  }

  async function submitBulkAssignments() {
    const keys = Object.keys(bulkCrops);
    if (!keys.length) {
      flagChequeProblem(
        ar ? 'قصّ شيكاً واحداً على الأقل من المسح قبل الإرسال.' : 'Crop at least one cheque from the scan before sending.',
        'bulk',
      );
      return;
    }
    setBulkSending(true);
    try {
      for (const key of keys) {
        const crop = bulkCrops[key];
        if (!crop) continue;
        const ok = await send(key, crop, { skipRefresh: true });
        if (!ok) return;
      }
      setBulkCrops({});
      setBulkMaster(null);
      router.refresh();
    } finally {
      setBulkSending(false);
    }
  }

  function renderSharedBankFields() {
    if (readOnly) {
      if (!(bankName || accountHolderName || accountNumber)) return null;
      return (
        <p className="lease-cheques__shared-read muted">
          {[bankName, accountHolderName, accountNumber ? `Acc ${accountNumber}` : '']
            .filter(Boolean)
            .join(' · ')}
        </p>
      );
    }
    const bankSelectOk = Boolean(bankSelectValue);
    const bankCustomOk = bankName.trim().length >= 2;
    const holderOk = accountHolderName.trim().length >= 2;
    const accountOk = accountNumber.trim().replace(/\s+/g, '').length >= 4;
    const tone = (ok: boolean) => `field ${ok ? 'field--ok' : 'field--missing'}`;
    return (
      <div className="lease-cheques__shared">
        <div className={tone(bankSelectOk)}>
          <label>
            {ar ? 'بنك الحساب (مرة واحدة لكل الشيكات)' : 'Account bank (once for all cheques)'}
            <select
              className="select"
              value={bankSelectValue}
              disabled={busy !== null || bulkSending}
              onChange={(event) => {
                const value = event.target.value;
                if (value === BANK_OTHER) {
                  setBankOther(true);
                  if (OMAN_BANKS.includes(bankName)) setBankName('');
                  return;
                }
                setBankOther(false);
                setBankName(value);
              }}
            >
              <option value="">{ar ? '— اختر البنك —' : '— Select bank —'}</option>
              {OMAN_BANKS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value={BANK_OTHER}>{ar ? 'بنك آخر…' : 'Other bank…'}</option>
            </select>
          </label>
        </div>
        {bankOther ? (
          <div className={tone(bankCustomOk)}>
            <label>
              {ar ? 'اسم البنك (يدوي)' : 'Bank name (custom)'}
              <input
                className="input"
                maxLength={160}
                value={bankName}
                disabled={busy !== null || bulkSending}
                onChange={(event) => setBankName(event.target.value)}
                placeholder={ar ? 'اكتب اسم البنك' : 'Type the bank name'}
              />
            </label>
          </div>
        ) : null}
        <div className={tone(holderOk)}>
          <label>
            {ar ? 'اسم صاحب الحساب (مرة واحدة)' : 'Account holder (once)'}
            <input
              className="input"
              maxLength={160}
              value={accountHolderName}
              disabled={busy !== null || bulkSending}
              onChange={(event) => setAccountHolderName(event.target.value)}
              placeholder={ar ? 'الاسم كما على دفتر الشيكات' : 'Name as on the cheque book'}
            />
          </label>
        </div>
        <div className={tone(accountOk)}>
          <label>
            {ar ? 'رقم الحساب البنكي (مرة واحدة)' : 'Bank account number (once)'}
            <input
              className="input"
              dir="ltr"
              maxLength={64}
              value={accountNumber}
              disabled={busy !== null || bulkSending}
              onChange={(event) => setAccountNumber(event.target.value)}
              placeholder={ar ? 'كما على دفتر الشيكات' : 'As on the cheque book'}
              autoComplete="off"
            />
          </label>
        </div>
      </div>
    );
  }

  function renderNumberInput(item: (typeof cheques)[number], index: number) {
    const canEdit = !readOnly && item.status !== 'approved';
    if (!canEdit) {
      return <span dir="ltr">{item.chequeNumber || numbers[item.key] || '—'}</span>;
    }
    return (
      <input
        className="input lease-cheques__number"
        dir="ltr"
        maxLength={80}
        value={numbers[item.key] ?? ''}
        disabled={busy !== null || bulkSending}
        aria-label={ar ? `رقم ${item.labelAr}` : `Number for ${item.labelEn}`}
        onChange={(event) => {
          const value = event.target.value;
          if (index === 0 || (value.trim() && /\d/.test(value))) {
            applySequenceFrom(index, value);
          } else {
            setNumbers((current) => ({ ...current, [item.key]: value }));
          }
        }}
        onBlur={(event) => {
          if (index === 0 && event.target.value.trim()) {
            applySequenceFrom(0, event.target.value);
          }
        }}
      />
    );
  }

  function renderFileCell(item: (typeof cheques)[number]) {
    const canEdit = !readOnly && item.status !== 'approved';
    const fileHref = item.fileName
      ? `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/files/cheque-${encodeURIComponent(item.key)}`
      : null;
    return (
      <div className="lease-docs__actions">
        {fileHref ? (
          <DocFileThumb
            href={fileHref}
            label={ar ? item.labelAr : item.labelEn}
            onOpen={() =>
              setPreview({
                href: fileHref,
                label: ar ? item.labelAr : item.labelEn,
              })
            }
          />
        ) : null}
        {canEdit ? (
          <label className="button button--quiet lease-docs__upload">
            {busy === item.key
              ? ar
                ? 'جارٍ…'
                : '…'
              : item.status === 'pending'
                ? ar
                  ? 'رفع صورة'
                  : 'Upload'
                : ar
                  ? 'استبدال'
                  : 'Replace'}
            <input
              type="file"
              accept="image/*,application/pdf"
              hidden
              disabled={busy !== null || bulkSending}
              onChange={(event) => pick(item.key, event)}
            />
          </label>
        ) : null}
        {!canEdit && !fileHref ? '—' : null}
      </div>
    );
  }

  function renderTable() {
    return (
      <div className="lease-cheques__table-wrap">
        <table className="lease-cheques__table">
          <thead>
            <tr>
              <th scope="col">{ar ? 'الشيك' : 'Cheque'}</th>
              <th scope="col">{ar ? 'المبلغ' : 'Amount'}</th>
              <th scope="col">{ar ? 'الاستحقاق' : 'Due'}</th>
              <th scope="col">{ar ? 'رقم الشيك' : 'Number'}</th>
              <th scope="col">{ar ? 'المرفق' : 'Attachment'}</th>
            </tr>
          </thead>
          <tbody>
            {cheques.map((item, index) => {
              const canEdit = !readOnly && item.status !== 'approved';
              const rowHasError = errorKey === item.key && Boolean(error);
              return (
                <tr
                  key={item.key}
                  className={`lease-cheques__row lease-cheques__row--${item.status}${
                    rowHasError ? ' lease-cheques__row--error' : ''
                  }`}
                >
                  <td>
                    <strong>{ar ? item.labelAr : item.labelEn}</strong>
                    <span className="lease-cheques__status">
                      <DocStatusMark
                        status={
                          item.autoApproved && item.status === 'approved' && !item.verified
                            ? 'submitted'
                            : item.status
                        }
                        ar={ar}
                        viewer="tenant"
                      />
                      {item.autoApproved && item.status === 'approved' && !item.verified
                        ? ar
                          ? 'قُبل إلكترونياً — قيد تحقق الفريق'
                          : 'Accepted electronically — team verifying'
                        : docStatusLabel(item.status, ar, 'tenant')}
                    </span>
                    {item.status === 'rejected' && item.note ? (
                      <small className="lease-cheques__note">
                        {ar ? 'ملاحظة: ' : 'Note: '}
                        {item.note}
                      </small>
                    ) : null}
                  </td>
                  <td className="lease-cheques__amount" dir="ltr">
                    {formatMoney(String(item.amountMinor), item.currency, ar ? 'ar' : 'en')}
                  </td>
                  <td className="lease-cheques__due" dir="ltr">
                    {item.dueOn || '—'}
                  </td>
                  <td
                    className={
                      canEdit
                        ? (numbers[item.key] ?? '').trim()
                          ? 'lease-cheques__cell--ok'
                          : 'lease-cheques__cell--missing'
                        : undefined
                    }
                  >
                    {renderNumberInput(item, index)}
                  </td>
                  <td
                    className={`lease-cheques__file${
                      canEdit
                        ? item.status === 'pending' || item.status === 'rejected'
                          ? ' lease-cheques__cell--missing'
                          : ' lease-cheques__cell--ok'
                        : ''
                    }`}
                  >
                    {renderFileCell(item)}
                    {rowHasError ? (
                      <small className="lease-cheques__row-error" role="alert">
                        {error}
                      </small>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderStep() {
    if (!stepItem) {
      return (
        <p className="notice notice--success" role="status">
          {ar ? 'كل الشيكات المطلوبة مرفوعة ✓' : 'Every required cheque is uploaded ✓'}
        </p>
      );
    }
    const index = cheques.findIndex((item) => item.key === stepItem.key);
    return (
      <div className="lease-docs__step lease-cheques__step">
        <div className="lease-docs__step-head">
          <strong>{ar ? stepItem.labelAr : stepItem.labelEn || stepItem.labelAr}</strong>
          <span className="muted">
            {ar
              ? `${Math.min(stepIndex, actionQueue.length - 1) + 1} من ${actionQueue.length} متبقٍ`
              : `${Math.min(stepIndex, actionQueue.length - 1) + 1} of ${actionQueue.length} remaining`}
          </span>
        </div>
        <p className="muted">
          {ar
            ? 'ارفع صورة هذا الشيك، ثم انتقل للتالي.'
            : 'Upload this cheque photo, then continue to the next.'}
        </p>
        <dl className="lease-cheques__step-meta">
          <div>
            <dt>{ar ? 'المبلغ' : 'Amount'}</dt>
            <dd dir="ltr">
              {formatMoney(String(stepItem.amountMinor), stepItem.currency, ar ? 'ar' : 'en')}
            </dd>
          </div>
          <div>
            <dt>{ar ? 'الاستحقاق' : 'Due'}</dt>
            <dd dir="ltr">{stepItem.dueOn || '—'}</dd>
          </div>
        </dl>
        <label className="field">
          {ar ? 'رقم الشيك' : 'Cheque number'}
          {renderNumberInput(stepItem, index >= 0 ? index : 0)}
        </label>
        {renderFileCell(stepItem)}
        <div className="lease-docs__step-actions">
          <button
            type="button"
            className="button button--quiet"
            disabled={stepIndex <= 0 || busy !== null}
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          >
            {ar ? 'السابق' : 'Previous'}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={stepIndex >= actionQueue.length - 1 || busy !== null}
            onClick={() =>
              setStepIndex((current) => Math.min(actionQueue.length - 1, current + 1))
            }
          >
            {ar ? 'التالي' : 'Next'}
          </button>
        </div>
      </div>
    );
  }

  function renderBulk() {
    if (readOnly) {
      return (
        <p className="muted">
          {ar ? 'وضع المسح الجماعي للرفع فقط.' : 'Bulk scan mode is for uploading only.'}
        </p>
      );
    }
    const assignedCount = Object.keys(bulkCrops).length;
    return (
      <div className="lease-cheques__bulk">
        <p className="muted">
          {ar
            ? 'صوّر كل الشيكات في صورة واحدة، ثم قصّ كل شيك وربطه بالشهر/القسط المناسب. بعدها تُرسل للمالك للاعتماد كالمعتاد.'
            : 'Photograph all cheques in one scan, then crop each cheque and link it to its month/installment. They go to the owner for approval as usual.'}
        </p>
        {!bulkMaster ? (
          <label className="button button--primary lease-docs__upload">
            {ar ? 'رفع مسح كل الشيكات' : 'Upload full cheque scan'}
            <input type="file" accept="image/*" hidden onChange={pickBulkMaster} />
          </label>
        ) : (
          <>
            <div className="lease-cheques__bulk-master">
              {bulkMasterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bulkMasterUrl} alt="" />
              ) : null}
              <div className="lease-cheques__bulk-master-actions">
                <strong>{bulkMaster.name}</strong>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={bulkSending}
                  onClick={() => {
                    setBulkMaster(null);
                    setBulkCrops({});
                    setBulkAssignKey(null);
                  }}
                >
                  {ar ? 'استبدال المسح' : 'Replace scan'}
                </button>
              </div>
            </div>
            <ul className="lease-cheques__bulk-list">
              {bulkQueue.map((item, index) => {
                const cropped = bulkCrops[item.key];
                const chequeIndex = cheques.findIndex((row) => row.key === item.key);
                return (
                  <li key={item.key} className={cropped ? 'is-done' : 'is-todo'}>
                    <div className="lease-cheques__bulk-row">
                      <strong>{ar ? item.labelAr : item.labelEn}</strong>
                      <span dir="ltr">
                        {formatMoney(String(item.amountMinor), item.currency, ar ? 'ar' : 'en')}
                        {item.dueOn ? ` · ${item.dueOn}` : ''}
                      </span>
                    </div>
                    <label className="field">
                      {ar ? 'رقم الشيك' : 'Cheque number'}
                      {renderNumberInput(item, chequeIndex >= 0 ? chequeIndex : index)}
                    </label>
                    <div className="lease-cheques__bulk-row-actions">
                      {cropped ? (
                        <span className="notice notice--success">
                          {ar ? 'تم القص لهذا الشهر' : 'Cropped for this month'}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="button button--quiet"
                        disabled={bulkSending}
                        onClick={() => startBulkCrop(item.key)}
                      >
                        {cropped
                          ? ar
                            ? 'إعادة القص'
                            : 'Re-crop'
                          : ar
                            ? 'قصّ الشيك لهذا الشهر'
                            : 'Crop cheque for this month'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="lease-cheques__bulk-submit">
              <p className="muted">
                {ar
                  ? `معيّن: ${assignedCount} من ${bulkQueue.length}`
                  : `Assigned: ${assignedCount} of ${bulkQueue.length}`}
              </p>
              <button
                type="button"
                className="button button--primary"
                disabled={bulkSending || assignedCount === 0}
                onClick={() => void submitBulkAssignments()}
              >
                {bulkSending
                  ? ar
                    ? 'جارٍ الإرسال…'
                    : 'Sending…'
                  : ar
                    ? 'إرسال الشيكات المعيّنة للمالك'
                    : 'Send assigned cheques to the owner'}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="lease-docs-wrap lease-cheques">
      <h3 className="lease-docs__heading">{ar ? '🧾 شيكات الإيجار' : '🧾 Rent cheques'}</h3>
      {lifecycle.chequePayableTo ? (
        <p className="lease-cheques__payable notice">
          {ar ? 'اكتب الشيكات باسم: ' : 'Make cheques payable to: '}
          <strong>{lifecycle.chequePayableTo}</strong>
          {lifecycle.chequeBankName ? (
            <>
              {' · '}
              {ar ? 'البنك: ' : 'Bank: '}
              {lifecycle.chequeBankName}
            </>
          ) : null}
        </p>
      ) : null}
      <p className="muted">
        {ar
          ? 'أدخل بنك الحساب واسم صاحبه ورقم الحساب مرة واحدة، ثم اختر طريقة الرفع من القائمة. في كل الحالات تصل الشيكات للمالك للاعتماد.'
          : 'Enter bank, account holder, and account number once, then pick an upload method from the list. In every mode the cheques go to the owner for approval.'}
      </p>
      {error ? (
        <p ref={errorRef} className="notice notice--error lease-cheques__alert" role="alert">
          {error}
        </p>
      ) : null}

      {renderSharedBankFields()}

      {!readOnly ? (
        <label className="field lease-cheques__mode-select">
          {ar ? 'طريقة رفع الشيكات' : 'Cheque upload method'}
          <select
            className="select"
            value={viewMode}
            disabled={busy !== null || bulkSending}
            onChange={(event) => chooseMode(event.target.value as ChequeViewMode | '')}
          >
            <option value="">{ar ? '— اختر طريقة الرفع —' : '— Choose upload method —'}</option>
            <option value="table">{ar ? 'واحداً واحداً من الجدول' : 'One by one from the table'}</option>
            <option value="step">{ar ? 'نافذة متتابعة (شيك ثم التالي)' : 'Step wizard (cheque then next)'}</option>
            <option value="bulk">
              {ar ? 'مسح الكل ثم تعيين كل شيك لشهره' : 'Scan all, then assign each cheque to its month'}
            </option>
          </select>
        </label>
      ) : null}

      {!viewMode && !readOnly ? (
        <p className="notice notice--info" role="status">
          {ar
            ? 'اختر طريقة الرفع من القائمة أعلاه لتظهر لك خيارات إرفاق الشيكات.'
            : 'Choose an upload method above to show the cheque attachment options.'}
        </p>
      ) : null}

      {viewMode === 'step'
        ? renderStep()
        : viewMode === 'bulk'
          ? renderBulk()
          : viewMode === 'table' || readOnly
            ? renderTable()
            : null}

      {pending ? (
        <UploadPrepareDialog
          file={pending.file}
          ar={ar}
          title={ar ? 'معاينة صورة الشيك قبل الإرسال' : 'Preview cheque photo before sending'}
          onCancel={() => setPending(null)}
          onConfirm={(file) =>
            void (viewMode === 'step' ? sendAndAdvance(pending.key, file) : send(pending.key, file))
          }
        />
      ) : null}
      {bulkMaster && bulkAssignKey && bulkAssignItem ? (
        <UploadPrepareDialog
          file={bulkMaster}
          ar={ar}
          title={
            ar
              ? `قصّ شيك «${bulkAssignItem.labelAr}» من المسح`
              : `Crop “${bulkAssignItem.labelEn || bulkAssignItem.labelAr}” from the scan`
          }
          onCancel={() => setBulkAssignKey(null)}
          onConfirm={confirmBulkCrop}
        />
      ) : null}
      {preview ? (
        <FilePreviewDialog file={preview} ar={ar} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}
