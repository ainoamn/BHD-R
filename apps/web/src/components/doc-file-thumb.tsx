'use client';

/** Small clickable preview of an uploaded document / cheque image (PDF falls back to a file mark). */
export function DocFileThumb({
  href,
  label,
  onOpen,
}: {
  href: string;
  label: string;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      className="doc-file-thumb"
      onClick={onOpen}
      aria-label={label}
      title={label}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={href}
        alt=""
        loading="lazy"
        onError={(event) => {
          event.currentTarget.classList.add('is-hidden');
          const fallback = event.currentTarget.nextElementSibling;
          if (fallback instanceof HTMLElement) fallback.hidden = false;
        }}
      />
      <span className="doc-file-thumb__fallback" hidden aria-hidden="true">
        PDF
      </span>
    </button>
  );
}
