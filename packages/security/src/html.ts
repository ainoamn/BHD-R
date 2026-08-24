import sanitizeHtml from 'sanitize-html';

export function sanitizeRichText(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'ul',
      'ol',
      'li',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
  });
}

export function sanitizeDocumentTemplate(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [
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
    ],
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

export function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
