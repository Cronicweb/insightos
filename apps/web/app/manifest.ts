import type { MetadataRoute } from 'next';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Installable metadata for the static export. Icon paths are prefixed manually
 * because `public/` assets are not rewritten by `basePath`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'InsightOS \u2014 the analytics operating system',
    short_name: 'InsightOS',
    description:
      'Profiles a dataset, scores its quality, infers the domain, computes the right KPIs and explains why they moved.',
    start_url: `${basePath}/`,
    scope: `${basePath}/`,
    display: 'standalone',
    background_color: '#0a0a0d',
    theme_color: '#4f6fd6',
    icons: [
      { src: `${basePath}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${basePath}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
