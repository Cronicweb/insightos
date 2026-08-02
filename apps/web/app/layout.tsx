import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';

/**
 * Plus Jakarta Sans: a geometric humanist sans with a tall x-height and open
 * apertures. Chosen because dashboards are read at a glance -- the wide
 * counters keep 7/1/4 distinct at 11px, and the tabular figures line up in
 * every metric column. Self-hosted by next/font, so no runtime request and no
 * layout shift.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-jakarta',
});

/**
 * Next 14 does not prefix the auto-injected manifest link with `basePath`, so
 * the Pages deployment would request `/manifest.webmanifest` and 404. Declaring
 * it here overrides that link with the correct path.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  manifest: `${basePath}/manifest.webmanifest`,
  title: 'InsightOS \u2014 the analytics operating system',
  description:
    'InsightOS profiles a dataset, scores its quality, infers the business domain, computes the right KPIs, explains why they moved and writes the executive brief \u2014 deterministically.',
  applicationName: 'InsightOS',
  authors: [{ name: 'InsightOS' }],
  keywords: [
    'analytics',
    'business intelligence',
    'root cause analysis',
    'data quality',
    'KPI',
    'statistics',
  ],
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e8effc' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0d' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
