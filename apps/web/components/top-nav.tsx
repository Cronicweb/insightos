'use client';

import * as React from 'react';
import { Moon, Sun, Github, Activity, PanelLeft } from 'lucide-react';
import { useTheme } from './theme-provider';
import { cn } from '@/lib/utils';

export type WorkspaceTab =
  | 'overview'
  | 'root-cause'
  | 'quality'
  | 'forecast'
  | 'actions'
  | 'sql'
  | 'report';

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'root-cause', label: 'Root Cause' },
  { id: 'quality', label: 'Data Quality' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'actions', label: 'Actions' },
  { id: 'sql', label: 'SQL' },
  { id: 'report', label: 'Report' },
];

export function TopNav({
  tab,
  onTabChange,
  engineVersion,
  onMenu,
}: {
  tab: WorkspaceTab;
  onTabChange: (t: WorkspaceTab) => void;
  engineVersion?: string;
  onMenu: () => void;
}) {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/65">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-6 lg:gap-6">
        <button
          onClick={onMenu}
          aria-label="Open datasets and metrics"
          className="-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink lg:hidden"
        >
          <PanelLeft className="h-[18px] w-[18px]" />
        </button>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-canvas">
            <Activity className="h-4 w-4" strokeWidth={2.4} />
          </div>
          <span className="text-[17px] font-semibold tracking-tight">InsightOS</span>
          {engineVersion ? (
            <span className="hidden whitespace-nowrap rounded-md border border-line px-1.5 py-0.5 text-2xs text-subtle sm:inline lg:hidden xl:inline">
              engine v{engineVersion}
            </span>
          ) : null}
        </div>

        <nav className="no-scrollbar hidden min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto lg:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                tab === t.id
                  ? 'bg-elevated font-semibold text-ink'
                  : 'text-muted hover:text-ink',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          <span className="mr-1 hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2.5 py-1 text-2xs text-muted xl:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-positive" />
            Demo mode &middot; static engine output
          </span>
          <a
            href="https://github.com/Cronicweb/insightos"
            target="_blank"
            rel="noreferrer"
            aria-label="Source on GitHub"
            className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink"
          >
            <Github className="h-[17px] w-[17px]" />
          </a>
          <button
            onClick={toggle}
            aria-label="Toggle colour theme"
            className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink"
          >
            {theme === 'dark' ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}
          </button>
        </div>
      </div>

      {/* Tabs collapse into a scroller on small screens rather than a hamburger. */}
      <nav className="no-scrollbar flex items-center gap-1 overflow-x-auto px-3 pb-2 sm:px-6 lg:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={cn(
              'shrink-0 rounded-lg px-3 py-2 text-[13px]',
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
