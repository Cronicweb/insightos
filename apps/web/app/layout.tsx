import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';

export const metadata: Metadata = {
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
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0f14' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
