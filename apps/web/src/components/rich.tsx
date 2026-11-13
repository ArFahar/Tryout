'use client';
import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/** Mengganti rumus berdelimiter \( … \) dan \[ … \] dengan keluaran KaTeX. */
export function renderMath(html: string): string {
  const render = (tex: string, displayMode: boolean) => {
    try {
      return katex.renderToString(decode(tex), { displayMode, throwOnError: false, output: 'htmlAndMathml' });
    } catch {
      return tex;
    }
  };
  return (html ?? '')
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => render(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => render(t, false));
}

/**
 * Satu-satunya komponen yang merender HTML mentah (UI/UX 6.7.10, TDD 5.13).
 * HTML sudah disanitasi di server (AD-10); rumus LaTeX dirender KaTeX menjadi HTML + MathML (terbaca pembaca layar).
 */
export function RichContent({ html, className, style }: { html: string; className?: string; style?: React.CSSProperties }) {
  const out = useMemo(() => renderMath(html), [html]);
  return <div className={`rich ${className ?? ''}`} style={style} dangerouslySetInnerHTML={{ __html: out }} />;
}
