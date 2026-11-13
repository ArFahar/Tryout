'use client';
import Link from 'next/link';
import React, { forwardRef, useId } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ------------------------------------------------------------- Button (6.7.1)
// primary: pil biru terisi · secondary: pil abu-abu · link: teks dengan chevron › · plain: teks tanpa chevron · danger: pil merah.
// 'solid' dan 'ghost' adalah alias v1.x (→ primary dan plain).
type Variant = 'primary' | 'solid' | 'secondary' | 'ghost' | 'danger' | 'link' | 'plain';
type Size = 'sm' | 'md' | 'lg';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700',
  solid: 'bg-primary-600 text-white hover:bg-primary-700',
  secondary: 'bg-neutral-100 text-neutral-900 hover:bg-neutral-200',
  ghost: 'text-link hover:underline underline-offset-2',
  plain: 'text-link hover:underline underline-offset-2',
  danger: 'bg-danger-700 text-white hover:bg-danger-800',
  link: 'text-link hover:underline underline-offset-2',
};
const PILL = new Set<Variant>(['primary', 'solid', 'secondary', 'danger']);
const SIZE: Record<Size, string> = { sm: 'h-8 px-3.5 text-callout', md: 'h-10 px-5 text-body', lg: 'h-12 px-6 text-body' };
const DISABLED = 'disabled:opacity-40 disabled:cursor-not-allowed';
const BASE = 'press inline-flex items-center justify-center gap-1.5 font-normal whitespace-nowrap';
const shape = (v: Variant, size: Size) => (PILL.has(v) ? cx('rounded-full', SIZE[size]) : cx('rounded-sm', size === 'sm' ? 'text-callout' : 'text-body', 'min-h-11 px-1'));
const Chevron = () => <span aria-hidden="true" className="text-[1.2em] leading-none">›</span>;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx(BASE, VARIANT[variant], shape(variant, size), DISABLED, className)}
      {...rest}>
      {loading && <Spinner />}
      {children}
      {variant === 'link' && <Chevron />}
    </button>
  );
});

export function ButtonLink({ href, variant = 'primary', size = 'md', className, children, ...rest }:
  { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <Link href={href} className={cx(BASE, VARIANT[variant], shape(variant, size), className)} {...rest}>
      {children}
      {variant === 'link' && <Chevron />}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ------------------------------------------------------------- Card (6.7.3)
// default: kontras dengan latar, radius-lg, tanpa garis tepi dan bayangan · highlight: garis 2 px primary · feature: radius-xl, padding 40.
export function Card({ className, children, as: As = 'section', variant = 'default', ...rest }: React.HTMLAttributes<HTMLElement> & { as?: any; variant?: 'default' | 'highlight' | 'feature' | 'muted' }) {
  const v = { default: 'rounded-lg bg-white p-5 sm:p-6', muted: 'rounded-lg bg-neutral-50 p-5 sm:p-6',
    highlight: 'rounded-lg bg-white p-5 ring-2 ring-primary-600 sm:p-6', feature: 'rounded-xl bg-white p-6 sm:p-10' }[variant];
  return <As className={cx(v, className)} {...rest}>{children}</As>;
}

// ------------------------------------------------------------- Kontrol bersegmen (6.7.11)
export function Segmented<T extends string>({ options, value, onChange, label, className }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex max-w-full overflow-x-auto rounded-full bg-neutral-100 p-1', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={cx('press min-h-9 whitespace-nowrap rounded-full px-4 text-callout', on ? 'bg-white font-semibold text-neutral-900 shadow-sm' : 'text-neutral-700 hover:text-neutral-900')}>
            {o.label}{o.count !== undefined && <span className="tabular ml-1.5 text-neutral-600">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Daftar "Yang kamu dapat" (6.7.13): centang primary-600 + teks. */
export function CheckList({ items, className }: { items: React.ReactNode[]; className?: string }) {
  return (
    <ul className={cx('space-y-3', className)}>
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------- Badge (6.7.7)
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary' | 'accent';
const TONE: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700',
  info: 'bg-primary-50 text-primary-800',
  primary: 'bg-primary-600 text-white',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  accent: 'bg-neutral-900 text-white',
};
export function Badge({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-caption font-semibold whitespace-nowrap', TONE[tone], className)}>
      {icon}{children}
    </span>
  );
}

// ------------------------------------------------------------- Alert (6.7.8)
const ALERT: Record<'info' | 'success' | 'warning' | 'danger', string> = {
  info: 'bg-primary-50 border-primary-600 text-primary-800',
  success: 'bg-success-50 border-success-700 text-success-700',
  warning: 'bg-warning-50 border-warning-700 text-warning-700',
  danger: 'bg-danger-50 border-danger-700 text-danger-700',
};
export function Alert({ tone = 'info', title, children, action, className, role }: { tone?: keyof typeof ALERT; title?: string; children?: React.ReactNode; action?: React.ReactNode; className?: string; role?: string }) {
  return (
    <div role={role ?? (tone === 'danger' ? 'alert' : 'status')} className={cx('flex gap-3 rounded-md border-l-4 px-4 py-3 text-callout', ALERT[tone], className)}>
      <AlertIcon tone={tone} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && 'mt-0.5')}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
function AlertIcon({ tone }: { tone: string }) {
  const d = tone === 'success' ? 'M5 12l4 4 10-10' : tone === 'info' ? 'M12 8h.01M11 12h1v5h1' : 'M12 8v5m0 3h.01';
  return (
    <svg className="mt-0.5 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" /><path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------- Inputs (6.7.2)
export function Field({ label, required, help, error, children, id }: { label: string; required?: boolean; help?: string; error?: string; children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const helpId = help ? `${fid}-help` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={fid} className="block text-callout font-semibold text-neutral-900">
        {label}{required && <span aria-hidden="true" className="text-danger-700"> *</span>}
        {required && <span className="sr-only"> (wajib diisi)</span>}
      </label>
      {children({ id: fid, 'aria-describedby': [helpId, errId].filter(Boolean).join(' ') || undefined, 'aria-invalid': error ? true : undefined })}
      {help && !error && <p id={helpId} className="text-footnote text-neutral-600">{help}</p>}
      {error && <p id={errId} className="flex items-center gap-1.5 text-footnote text-danger-700"><span aria-hidden="true">⚠</span>{error}</p>}
    </div>
  );
}
const INPUT = 'block w-full rounded-md border border-neutral-400 bg-white px-3.5 text-body text-neutral-900 placeholder:text-neutral-600 hover:border-neutral-600 focus:border-primary-600 aria-[invalid=true]:border-2 aria-[invalid=true]:border-danger-700 disabled:bg-neutral-100';
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx(INPUT, 'h-12', className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cx(INPUT, 'h-12', className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cx(INPUT, 'py-2 min-h-24', className)} {...p} />;
});

// ------------------------------------------------------------- Lainnya
export function PageHeader({ title, description, back, actions }: { title: string; description?: React.ReactNode; back?: { href: string; label: string }; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 space-y-2">
      {back && <Link href={back.href} className="inline-flex min-h-11 items-center gap-1 text-callout text-link hover:underline">‹ {back.label}</Link>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px]/8 font-bold tracking-[-0.01em] text-neutral-900 sm:text-title-1">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-neutral-600">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-white px-6 py-12 text-center">
      <svg className="mb-3 h-10 w-10 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
      </svg>
      <p className="text-headline font-semibold text-neutral-900">{title}</p>
      {children && <div className="mt-1 max-w-md text-callout text-neutral-600">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-neutral-100', className)} aria-hidden="true" />;
}

export function LoadingBlock({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function ProgressBar({ value, max = 1, label, className }: { value: number; max?: number; label?: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-neutral-200', className)} aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined} aria-label={label}>
      <div className="h-full rounded-full bg-primary-600" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Dialog({ open, title, children, footer, onClose, labelledBy }: { open: boolean; title: string; children: React.ReactNode; footer: React.ReactNode; onClose: () => void; labelledBy?: string }) {
  const id = useId();
  const ref = React.useRef<HTMLDivElement>(null);
  const prev = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement as HTMLElement;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev.current?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? id}
        className="w-full max-w-[400px] rounded-t-xl bg-white p-6 shadow-lg sm:rounded-lg">
        <h2 id={labelledBy ?? id} className="text-title-3 font-semibold text-neutral-900">{title}</h2>
        <div className="mt-3 text-neutral-700">{children}</div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
      </div>
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  // Wordmark sementara; logo resmi Cogniverse belum ada (OQ-U1)
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[19px] font-semibold tracking-[-0.01em] text-neutral-900', className)}>
      <svg viewBox="0 0 28 28" className="h-6 w-6" aria-hidden="true">
        <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="14" cy="14" r="4" fill="var(--color-primary-600)" />
        <ellipse cx="14" cy="14" rx="11" ry="4" fill="none" stroke="currentColor" strokeWidth="1.25" transform="rotate(-25 14 14)" />
      </svg>
      Cogniverse
    </span>
  );
}
