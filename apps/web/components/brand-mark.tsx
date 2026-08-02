import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The InsightOS mark, inlined as SVG so it renders at any size, follows the
 * theme and needs no network round-trip. It is the same geometry as the
 * favicon (`app/icon.svg`): three bars where the last one drops, and a
 * detached dot marking where it was expected to land - the product's own
 * question, "why did this KPI change", drawn in four shapes.
 */
export function BrandMark({
  className,
  titleId,
}: {
  className?: string;
  titleId?: string;
}) {
  const gradientId = React.useId();
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('h-7 w-7 shrink-0 rounded-lg', className)}
      role="img"
      aria-label="InsightOS"
      aria-labelledby={titleId}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5B7BE0" />
          <stop offset="0.55" stopColor="#4F6FD6" />
          <stop offset="1" stopColor="#2F3F86" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill={`url(#${gradientId})`} />
      <g fill="#ffffff">
        <rect x="6.5" y="18" width="5" height="7.5" rx="1.6" opacity="0.82" />
        <rect x="13.5" y="11" width="5" height="14.5" rx="1.6" />
        <rect x="20.5" y="20.5" width="5" height="5" rx="1.6" opacity="0.5" />
        <circle cx="23" cy="9.5" r="2.4" />
      </g>
    </svg>
  );
}
