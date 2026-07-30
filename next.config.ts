import type { NextConfig } from 'next'

/**
 * Internal platform: no public surface, no image CDN, no analytics.
 * Security headers are set here rather than in middleware so they apply to
 * static assets too.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Internal tool — never index, even if it is ever exposed by accident.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Fail the production build on type errors rather than shipping them.
  // Next 16 no longer runs ESLint during `next build`, so linting is a separate
  // step — see the `verify` script, which is what CI should run.
  typescript: { ignoreBuildErrors: false },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
