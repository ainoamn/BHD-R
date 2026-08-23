import sanitizeHtml from 'sanitize-html';

const allowedTags = [
  'article',
  'section',
  'header',
  'footer',
  'main',
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'span',
  'strong',
  'em',
  'small',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
] as const;

export function sanitizeDocumentFragment(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [...allowedTags],
    allowedAttributes: {
      '*': ['dir', 'lang'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
    },
    allowedSchemes: [],
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    parser: { lowerCaseAttributeNames: true },
  });
}

export function wrapPrintableHtml(fragment: string, locale: 'ar' | 'en'): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <style>
    @page { size: A4; margin: 18mm 15mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #092D24; background: #FBFAF7; font: 13px/1.65 "Noto Sans Arabic", "Noto Sans", Arial, sans-serif; }
    h1, h2, h3, h4 { color: #174B70; line-height: 1.3; break-after: avoid; }
    h1 { font-size: 25px; } h2 { font-size: 19px; } h3 { font-size: 16px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { border: 1px solid #B58D55; padding: 7px 9px; text-align: start; vertical-align: top; }
    th { background: #F4F0E8; color: #092D24; }
    tr, p, li { break-inside: avoid; }
    footer { margin-top: 24px; color: #174B70; font-size: 11px; }
  </style>
</head>
<body>${fragment}</body>
</html>`;
}
