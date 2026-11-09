import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site/content'
import { GUIDES, guidePath } from '@/lib/site/guides'

// Update `lastModified` when a page's content really changes, not on every build.
const PAGES: { path: string; lastModified: string; priority: number }[] = [
  { path: '', lastModified: '2026-11-09', priority: 1 },
  { path: '/welcome/method', lastModified: '2026-10-07', priority: 0.8 },
  { path: '/welcome/roadmap', lastModified: '2026-10-23', priority: 0.6 },
  { path: '/welcome/guides', lastModified: GUIDES.map((guide) => guide.updated).sort().at(-1)!, priority: 0.7 },
  ...GUIDES.map((guide) => ({ path: guidePath(guide), lastModified: guide.updated, priority: 0.7 })),
  { path: '/privacy', lastModified: '2026-11-09', priority: 0.3 },
  { path: '/terms', lastModified: '2026-10-07', priority: 0.3 },
]

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((page) => ({ url: `${SITE_URL}${page.path}`, lastModified: page.lastModified, priority: page.priority }))
}
