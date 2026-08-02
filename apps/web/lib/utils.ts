import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Categorical palette. Deliberately muted and print-safe: this is an executive
 * tool, not a data-art piece. Colours are stable per index so the same segment
 * keeps the same colour across the marimekko, donut and table.
 */
export const PALETTE = [
  '#4F6BED',
  '#8B5CF6',
  '#0E9F8B',
  '#E0A82E',
  '#E36A6A',
  '#3B9BD6',
  '#A855A8',
  '#5C9A55',
  '#C2703E',
  '#6B7280',
];

export const PALETTE_SOFT = [
  '#DCE3FB',
  '#EADDFD',
  '#D3F0EB',
  '#F8EBCB',
  '#FADCDC',
  '#D6E9F7',
  '#EEDCEE',
  '#DDEBDB',
  '#F3E0D2',
  '#E5E7EB',
];

export function colourAt(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export function softColourAt(index: number): string {
  return PALETTE_SOFT[index % PALETTE_SOFT.length];
}

export const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-negative/10 text-negative border-negative/25',
  high: 'bg-warning/10 text-warning border-warning/25',
  medium: 'bg-accent/10 text-accent border-accent/25',
  low: 'bg-muted/10 text-muted border-line',
  info: 'bg-muted/10 text-muted border-line',
};

export const ROLE_STYLE: Record<string, string> = {
  driver: 'bg-negative/10 text-negative border-negative/25',
  offset: 'bg-positive/10 text-positive border-positive/25',
  stable: 'bg-muted/10 text-muted border-line',
};
