/**
 * Konversi sederhana antara teks editor dan HTML tersimpan.
 * Editor MVP memakai area teks: paragraf dipisah baris kosong, rumus LaTeX dengan \( … \),
 * dan tag dasar (<strong>, <em>, <blockquote>, <ul>, <ol>) boleh diketik langsung.
 * Server tetap menyanitasi seluruh HTML (AD-10). Editor WYSIWYG ditunda.
 */
const BLOCK = /^<(blockquote|ul|ol|table|p)\b/i;

export function textToHtml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => (BLOCK.test(c) ? c : `<p>${c.replace(/\n/g, '<br>')}</p>`))
    .join('');
}

export function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/^<p>|<\/p>$/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*(?=<(blockquote|ul|ol|table))/gi, '\n\n')
    .replace(/(<\/(blockquote|ul|ol|table)>)\s*<p>/gi, '$1\n\n')
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '')
    .trim();
}
