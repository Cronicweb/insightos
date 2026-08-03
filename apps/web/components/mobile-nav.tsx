'use client';

import * as React from 'react';
import {
  BarChart3,
  FileText,
  GitBranch,
  Lightbulb,
  MoreHorizontal,
  ShieldCheck,
  Sparkles,
  Terminal,
  TrendingUp,
  X,
  ScrollText,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceTab } from './top-nav';

const PRIMARY: { id: WorkspaceTab; label: string; icon: typeof BarChart3 }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'root-cause', label: 'Why', icon: GitBranch },
  { id: 'actions', label: 'Actions', icon: Lightbulb },
  { id: 'report', label: 'Report', icon: FileText },
];

const SECONDARY: { id: WorkspaceTab; label: string; icon: typeof BarChart3 }[] = [
  { id: 'ledger', label: 'Ledger', icon: ScrollText },
  { id: 'case-study', label: 'Case Study', icon: BookOpen },
  { id: 'quality', label: 'Data Quality', icon: Sparkles },
  { id: 'governance', label: 'Governance', icon: ShieldCheck },
  { id: 'forecast', label: 'Forecast', icon: TrendingUp },
  { id: 'sql', label: 'SQL console', icon: Terminal },
];

/**
 * Mobile primary navigation. Replaces the horizontal tab scroller with a
 * thumb-reachable bar; the four less-used tabs live behind a sheet so every
 * target stays at least 44px.
 */
export function MobileNav({
  tab,
  onTabChange,
}: {
  tab: WorkspaceTab;
  onTabChange: (t: WorkspaceTab) => void;
}) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const sheetRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    sheetRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const inSecondary = SECONDARY.some((s) => s.id === tab);

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close the navigation sheet"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/45"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="More workspace views"
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-[14px] font-semibold">More views</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <ul className="p-2">
              {SECONDARY.map((s) => {
                const Icon = s.icon;
                const active = tab === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onTabChange(s.id);
                        setMoreOpen(false);
                      }}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-[52px] w-full items-center gap-3 rounded-lg px-3 text-left text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                        active ? 'bg-elevated font-semibold text-ink' : 'text-muted',
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" aria-hidden />
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Workspace views"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {PRIMARY.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onTabChange(t.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[56px] w-full flex-col items-center justify-center gap-1 px-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                    active ? 'text-accent' : 'text-muted',
                  )}
                >
                  <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.4 : 2} aria-hidden />
                  <span className={cn('text-[10.5px] leading-none', active && 'font-semibold')}>
                    {t.label}
                  </span>
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={cn(
                'flex min-h-[56px] w-full flex-col items-center justify-center gap-1 px-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                inSecondary ? 'text-accent' : 'text-muted',
              )}
            >
              <MoreHorizontal className="h-[19px] w-[19px]" aria-hidden />
              <span className={cn('text-[10.5px] leading-none', inSecondary && 'font-semibold')}>
                More
              </span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
