import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site/content'

/**
 * Public pages are open; the signed-in app is disallowed (it only redirects crawlers
 * to the login page). /auth is deliberately NOT disallowed: a crawler must be able to
 * fetch it to see its noindex tag (app/auth/layout.tsx).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/welcome', '/privacy', '/terms'],
        disallow: [
          '/api/', '/home', '/training', '/food', '/history', '/weekly', '/workout',
          '/settings', '/onboarding', '/body-metrics',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
