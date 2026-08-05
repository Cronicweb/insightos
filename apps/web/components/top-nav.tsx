'use client';

import * as React from 'react';
import { Moon, Sun, Github, PanelLeft, Settings } from 'lucide-react';
import { useTheme } from './theme-provider';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/brand-mark';

export type WorkspaceTab =
  | 'overview'
  | 'root-cause'
  | 'quality'
  | 'governance'
  | 'forecast'
  | 'actions'
  | 'sql'
  | 'ledger'
  | 'case-study'
  | 'report'
  | 'analyst';

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'root-cause', label: 'Root Cause' },
  { id: 'quality', label: 'Data Quality' },
  { id: 'governance', label: 'Governance' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'actions', label: 'Actions' },
  { id: 'sql', label: 'SQL' },
  { id: 'report', label: 'Report' },
  { id: 'case-study', label: 'Case Study' },
  { id: 'analyst', label: 'Insight Analyst' },
];

export function TopNav({
  tab,
  onTabChange,
  engineVersion,
  onMenu,
  onHome,
  onSettings,
}: {
  tab: WorkspaceTab;
  onTabChange: (t: WorkspaceTab) => void;
  engineVersion?: string;
  onMenu: () => void;
  onHome?: () => void;
  onSettings?: () => void;
}) {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/65">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-6 lg:gap-6">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open datasets and metrics"
          className="-ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:hidden"
        >
          <PanelLeft className="h-[18px] w-[18px]" aria-hidden />
        </button>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onHome}
            aria-label="Back to the InsightOS home page"
            className="flex items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <BrandMark className="h-7 w-7" />
            <span className="text-[17px] font-semibold tracking-tight">InsightOS</span>
          </button>
          {engineVersion ? (
            <span className="hidden whitespace-nowrap rounded-md border border-line px-1.5 py-0.5 text-2xs text-subtle sm:inline lg:hidden xl:inline">
              engine v{engineVersion}
            </span>
          ) : null}
        </div>

        <nav
          aria-label="Workspace views"
          className="no-scrollbar hidden min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto lg:flex"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
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
          <button
            type="button"
            onClick={onSettings}
            aria-label="AI Settings"
            title="AI Settings"
            className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Settings className="h-[17px] w-[17px]" aria-hidden />
          </button>
          <a
            href="https://github.com/Cronicweb/insightos"
            target="_blank"
            rel="noreferrer"
            aria-label="Source on GitHub"
            className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Github className="h-[17px] w-[17px]" aria-hidden />
          </a>
          <button
            type="button"
            onClick={toggle}
            aria-label="Toggle colour theme"
            className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {theme === 'dark' ? <Sun className="h-[17px] w-[17px]" aria-hidden /> : <Moon className="h-[17px] w-[17px]" aria-hidden />}
          </button>
        </div>
      </div>

    </header>
  );
}
