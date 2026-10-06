import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site/content'

// Update `lastModified` when a page's content really changes, not on every build.
const PAGES: { path: string; lastModified: string; priority: number }[] = [
  { path: '/welcome', lastModified: '2026-10-06', priority: 1 },
  { path: '/welcome/method', lastModified: '2026-10-06', priority: 0.8 },
  { path: '/welcome/roadmap', lastModified: '2026-10-06', priority: 0.6 },
  { path: '/privacy', lastModified: '2026-10-06', priority: 0.3 },
  { path: '/terms', lastModified: '2026-10-06', priority: 0.3 },
]

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((page) => ({ url: `${SITE_URL}${page.path}`, lastModified: page.lastModified, priority: page.priority }))
}
