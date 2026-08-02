'use client';

import * as React from 'react';
import { Moon, Sun, Github, Activity } from 'lucide-react';
import { useTheme } from './theme-provider';
import { cn } from '@/lib/utils';

export type WorkspaceTab =
  | 'overview'
  | 'root-cause'
  | 'quality'
  | 'forecast'
  | 'actions'
  | 'report';

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'root-cause', label: 'Root Cause' },
  { id: 'quality', label: 'Data Quality' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'actions', label: 'Actions' },
  { id: 'report', label: 'Report' },
];

export function TopNav({
  tab,
  onTabChange,
  engineVersion,
}: {
  tab: WorkspaceTab;
  onTabChange: (t: WorkspaceTab) => void;
  engineVersion?: string;
}) {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="flex h-14 items-center gap-6 px-4 sm:px-6">
        <div className="flex shrink-0 items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-canvas">
            <Activity className="h-4 w-4" strokeWidth={2.4} />
          </div>
          <span className="text-[17px] font-semibold tracking-tight">InsightOS</span>
          {engineVersion ? (
            <span className="hidden rounded-md border border-line px-1.5 py-0.5 text-2xs text-subtle sm:inline">
              engine v{engineVersion}
            </span>
          ) : null}
        </div>

        <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                tab === t.id
                  ? 'bg-elevated font-semibold text-ink'
                  : 'text-muted hover:text-ink',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-1 hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-2xs text-muted md:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-positive" />
            Demo mode &middot; static engine output
          </span>
          <a
            href="https://github.com/Cronicweb/insightos"
            target="_blank"
            rel="noreferrer"
            aria-label="Source on GitHub"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink"
          >
            <Github className="h-[17px] w-[17px]" />
          </a>
          <button
            onClick={toggle}
            aria-label="Toggle colour theme"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink"
          >
            {theme === 'dark' ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}
          </button>
        </div>
      </div>

      {/* Tabs collapse into a scroller on small screens rather than a hamburger. */}
      <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-2 lg:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={cn(
              'shrink-0 rounded-lg px-3 py-1.5 text-[13px]',
              tab === t.id ? 'bg-elevated font-semibold text-ink' : 'text-muted',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
