'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { fixed } from '@/lib/format';

/* ------------------------------------------------------------------ Card */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border border-line bg-surface shadow-card', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-start justify-between gap-4 p-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[15px] font-semibold tracking-tight', className)} {...props} />;
}

export function CardSubtitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-0.5 text-xs text-muted', className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

/* ----------------------------------------------------------------- Badge */

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'accent' | 'positive' | 'negative' | 'warning' | 'solid';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-elevated text-muted border-line',
    accent: 'bg-accent/10 text-accent border-accent/25',
    positive: 'bg-positive/10 text-positive border-positive/25',
    negative: 'bg-negative/10 text-negative border-negative/25',
    warning: 'bg-warning/10 text-warning border-warning/25',
    solid: 'bg-ink text-canvas border-transparent',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium leading-none',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Blue/purple pill used for period-over-period deltas, as in the reference UI. */
export function DeltaPill({
  value,
  favourable,
  className,
}: {
  value: number | null | undefined;
  favourable?: boolean | null;
  className?: string;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-2xs text-subtle">&mdash;</span>;
  }
  const up = value >= 0;
  const good = favourable === undefined || favourable === null ? up : favourable;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular',
        good ? 'bg-accent/10 text-accent' : 'bg-[#8B5CF6]/10 text-[#7C4DE0] dark:text-[#B79BFA]',
        className,
      )}
    >
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
        <path
          d={up ? 'M5 2 L9 7 H1 Z' : 'M5 8 L1 3 H9 Z'}
          fill="currentColor"
          opacity="0.85"
        />
      </svg>
      {fixed(Math.abs(value), 1)}%
    </span>
  );
}

/* ------------------------------------------------------------- Segmented */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: {
  options: { value: T; label: React.ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl border border-line bg-elevated p-0.5',
        className,
      )}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-[10px] font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-2xs' : 'px-3 py-1.5 text-xs',
              active
                ? 'bg-surface text-ink shadow-card'
                : 'text-muted hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Misc */

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-elevated px-1.5 py-0.5 font-sans text-2xs text-subtle">
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-elevated', className)} />;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">{children}</div>
  );
}

/** A thin horizontal share bar, matching the "% of assets" column in the reference UI. */
export function ShareBar({ pct, colour }: { pct: number; colour?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line/60">
      <div
        className="h-full rounded-full"
        style={{ width: `${clamped}%`, backgroundColor: colour ?? 'rgb(var(--accent))' }}
      />
    </div>
  );
}
