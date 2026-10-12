'use client';

import { useEffect, useState } from 'react';

const PRINTING_CLASS = 'printing-contract';
const IMAGE_WAIT_MS = 8_000;

type Recipient = { name: string | null; email: string | null; phone: string | null };

/** A document on the page that can go into the print, e.g. the contract and its annexes. */
type PrintPart = { id: string; label: string; available: boolean };

/** Lazy images in a hidden part have not loaded yet; print only once they have (or time out). */
function imagesReady(root: HTMLElement): Promise<void> {
  const pending = [...root.querySelectorAll('img')].filter((img) => {
    img.loading = 'eager';
    return !img.complete;
  });
  if (!pending.length) return Promise.resolve();
  return Promise.race([
    Promise.all(
      pending.map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
      ),
    ).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, IMAGE_WAIT_MS)),
  ]);
}

function whatsappNumber(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length === 8 ? `968${digits}` : digits;
}

/**
 * Print / PDF / share / send for the contract document rendered in `#${documentId}`.
 * Printing copies that node into a body-level container so only the document reaches the page.
 */
export function ContractDocumentToolbar({
  ar,
  documentId,
  title,
  reference,
  summary,
  recipient,
  recipientPath,
  pdfUrl,
  parts = null,
}: {
  ar: boolean;
  documentId: string;
  title: string;
  reference: string;
  summary: string;
  recipient: Recipient | null;
  /** Page the other party can open for this contract (guest stay page or tenant portal). */
  recipientPath: string | null;
  pdfUrl: string | null;
  /** When set, printing first asks which of these documents to include. */
  parts?: PrintPart[] | null;
}) {
  const [printing, setPrinting] = useState<string[] | null>(null);
  const [picker, setPicker] = useState<'print' | 'pdf' | null>(null);
  const [selected, setSelected] = useState<string[]>([documentId]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!printing) return;
    const sources = printing
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => Boolean(node));
    if (!sources.length) {
      setPrinting(null);
      return;
    }
    const body = document.body;
    const holder = document.createElement('div');
    holder.className =
      sources.length > 1 ? 'contract-print contract-print--bundle' : 'contract-print';
    holder.setAttribute('aria-hidden', 'true');
    for (const source of sources) holder.appendChild(source.cloneNode(true));
    body.appendChild(holder);
    body.classList.add(PRINTING_CLASS);
    const previousTitle = document.title;
    document.title = `${reference} — ${title}`;
    let cancelled = false;
    const finish = () => {
      body.classList.remove(PRINTING_CLASS);
      holder.remove();
      document.title = previousTitle;
      setPrinting(null);
    };
    window.addEventListener('afterprint', finish, { once: true });
    void imagesReady(holder).then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
      window.removeEventListener('afterprint', finish);
      body.classList.remove(PRINTING_CLASS);
      holder.remove();
      document.title = previousTitle;
    };
  }, [printing, reference, title]);

  const choosable = parts?.some((part) => part.id !== documentId && part.available) ?? false;
  const start = (mode: 'print' | 'pdf') => {
    if (choosable) {
      setPicker(picker === mode ? null : mode);
      return;
    }
    if (mode === 'pdf') showPdfHint();
    setPrinting([documentId]);
  };
  const showPdfHint = () =>
    setNotice(
      ar
        ? 'اختر «حفظ بصيغة PDF» من نافذة الطباعة لحفظ نسخة مطابقة للعقد.'
        : 'Choose “Save as PDF” in the print dialog to keep an exact copy.',
    );
  const printSelected = (ids: string[]) => {
    if (!ids.length) return;
    if (picker === 'pdf') showPdfHint();
    setPicker(null);
    setPrinting(ids);
  };
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  const ordered = (parts ?? []).filter((part) => part.available && selected.includes(part.id));

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const absolute = (path: string) => new URL(path, window.location.origin).toString();
  const recipientLink = () => (recipientPath ? absolute(recipientPath) : window.location.href);
  const message = () => `${title} ${reference}\n${summary}\n${recipientLink()}`;

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${title} ${reference}`, text: summary, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setNotice(ar ? 'نُسخ رابط العقد.' : 'Contract link copied.');
    } catch {
      setNotice(url);
    }
  };

  const sendEmail = () => {
    const subject = encodeURIComponent(`${title} ${reference}`);
    const body = encodeURIComponent(message());
    window.location.href = `mailto:${recipient?.email ?? ''}?subject=${subject}&body=${body}`;
  };

  const sendWhatsapp = () => {
    const to = recipient?.phone ? whatsappNumber(recipient.phone) : '';
    window.open(
      `https://wa.me/${to}?text=${encodeURIComponent(message())}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  return (
    <div
      className="contract-doc-toolbar"
      role="toolbar"
      aria-label={ar ? 'أدوات العقد' : 'Contract tools'}
    >
      <button
        type="button"
        className="button button--primary"
        aria-expanded={choosable ? picker === 'print' : undefined}
        onClick={() => start('print')}
      >
        {ar ? 'طباعة' : 'Print'}
      </button>
      <button
        type="button"
        className="button button--secondary"
        aria-expanded={choosable ? picker === 'pdf' : undefined}
        onClick={() => start('pdf')}
      >
        {ar ? 'تصدير PDF' : 'Export PDF'}
      </button>
      {pdfUrl ? (
        <a
          className="button button--secondary"
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {ar ? 'النسخة المختومة' : 'Sealed PDF'}
        </a>
      ) : null}
      <button type="button" className="button button--secondary" onClick={() => void share()}>
        {ar ? 'مشاركة' : 'Share'}
      </button>
      <button type="button" className="button button--secondary" onClick={sendEmail}>
        {ar ? 'إرسال بالبريد' : 'Send by email'}
      </button>
      <button type="button" className="button button--secondary" onClick={sendWhatsapp}>
        {ar ? 'إرسال واتساب' : 'Send on WhatsApp'}
      </button>
      {recipient?.name ? (
        <span className="contract-doc-toolbar__to">
          {ar ? 'المرسل إليه: ' : 'To: '}
          {recipient.name}
        </span>
      ) : null}
      {picker && parts ? (
        <fieldset className="contract-print-picker">
          <legend>
            {picker === 'pdf'
              ? ar
                ? 'ماذا تريد أن يتضمن ملف PDF؟'
                : 'What should the PDF include?'
              : ar
                ? 'ماذا تريد أن تطبع؟'
                : 'What do you want to print?'}
          </legend>
          <ul>
            {parts.map((part) => (
              <li key={part.id}>
                <label className={part.available ? undefined : 'is-unavailable'}>
                  <input
                    type="checkbox"
                    checked={part.available && selected.includes(part.id)}
                    disabled={!part.available}
                    onChange={() => toggle(part.id)}
                  />
                  <span>{part.label}</span>
                  {part.available ? null : (
                    <small>{ar ? 'لم يُسجَّل بعد' : 'Not recorded yet'}</small>
                  )}
                </label>
                {part.available ? (
                  <button
                    type="button"
                    className="button button--quiet button--sm"
                    onClick={() => printSelected([part.id])}
                  >
                    {ar ? 'هذا وحده' : 'This only'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="muted">
            {ar
              ? 'تُطبع المستندات المحددة معاً، ويبدأ كل محضر في صفحة جديدة. ولطباعة كل مستند على حدة اضغط «هذا وحده».'
              : 'The selected documents print together, each record on a new page. To print one on its own, use “This only”.'}
          </p>
          <div className="contract-print-picker__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={!ordered.length}
              onClick={() => printSelected(ordered.map((part) => part.id))}
            >
              {picker === 'pdf'
                ? ar
                  ? `تصدير المحدد (${ordered.length})`
                  : `Export selected (${ordered.length})`
                : ar
                  ? `طباعة المحدد (${ordered.length})`
                  : `Print selected (${ordered.length})`}
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() =>
                setSelected(parts.filter((part) => part.available).map((part) => part.id))
              }
            >
              {ar ? 'تحديد الكل' : 'Select all'}
            </button>
            <button type="button" className="button button--quiet" onClick={() => setPicker(null)}>
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </fieldset>
      ) : null}
      {notice ? (
        <p className="contract-doc-toolbar__notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
