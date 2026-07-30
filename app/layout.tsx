import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans_Arabic } from 'next/font/google'

import './globals.css'

/**
 * Self-hosted at build time by next/font, so a user's browser never makes a
 * request to Google. That matters here: this is an internal tool that may run
 * on a restricted network, and it must not leak page views to a third party.
 */
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-plex-arabic',
})

export const metadata: Metadata = {
  title: {
    default: 'منصة الرصد القانوني',
    template: '%s · منصة الرصد القانوني',
  },
  description: 'منصة داخلية لرصد التحديثات القانونية والتنظيمية في دول مجلس التعاون الخليجي',
  // Internal platform: never indexed, never previewed.
  robots: { index: false, follow: false, nocache: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={plexArabic.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
