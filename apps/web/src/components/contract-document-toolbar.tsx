'use client';

import { useEffect, useState } from 'react';

const PRINTING_CLASS = 'printing-contract';

type Recipient = { name: string | null; email: string | null; phone: string | null };

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
}) {
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!printing) return;
    const source = document.getElementById(documentId);
    if (!source) {
      setPrinting(false);
      return;
    }
    const body = document.body;
    const holder = document.createElement('div');
    holder.className = 'contract-print';
    holder.setAttribute('aria-hidden', 'true');
    holder.appendChild(source.cloneNode(true));
    body.appendChild(holder);
    body.classList.add(PRINTING_CLASS);
    const previousTitle = document.title;
    document.title = `${reference} — ${title}`;
    const finish = () => {
      body.classList.remove(PRINTING_CLASS);
      holder.remove();
      document.title = previousTitle;
      setPrinting(false);
    };
    window.addEventListener('afterprint', finish, { once: true });
    const frame = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', finish);
      body.classList.remove(PRINTING_CLASS);
      holder.remove();
      document.title = previousTitle;
    };
  }, [printing, documentId, reference, title]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const absolute = (path: string) => new URL(path, window.location.origin).toString();
  const recipientLink = () => (recipientPath ? absolute(recipientPath) : window.location.href);
  const message = () => `${title} ${reference}\n${summary}\n${recipientLink()}`;

  const exportPdf = () => {
    setNotice(
      ar
        ? 'اختر «حفظ بصيغة PDF» من نافذة الطباعة لحفظ نسخة مطابقة للعقد.'
        : 'Choose “Save as PDF” in the print dialog to keep an exact copy.',
    );
    setPrinting(true);
  };

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
      <button type="button" className="button button--primary" onClick={() => setPrinting(true)}>
        {ar ? 'طباعة' : 'Print'}
      </button>
      <button type="button" className="button button--secondary" onClick={exportPdf}>
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
      {notice ? (
        <p className="contract-doc-toolbar__notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
