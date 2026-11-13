import sanitizeHtml from 'sanitize-html';

// AD-10: konten soal disimpan sebagai HTML yang disanitasi di server; rumus sebagai LaTeX berdelimiter.
export function sanitizeRich(html: string): string {
  return sanitizeHtml(html ?? '', {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'code', 'pre', 'span'],
    allowedAttributes: { img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    allowedSchemes: ['https'],
    allowedSchemesByTag: { img: ['https'] },
    disallowedTagsMode: 'discard',
  }).trim();
}

export function plainText(html: string): string {
  return sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} })
    .replace(/\\\(|\\\)|\\\[|\\\]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
