/**
 * InsightOS ships as a fully static site so the GitHub Pages deployment works
 * without any backend. `basePath` is injected by CI (`NEXT_PUBLIC_BASE_PATH`)
 * because project pages are served from `/<repo>`.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // Type errors are surfaced by the dedicated `typecheck` job in CI rather than
  // by the Pages build, so a type nit can never take the published demo down.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
