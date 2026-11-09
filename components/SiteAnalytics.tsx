import Script from 'next/script'
// Lives outside components/site on purpose: it holds no visitor-facing copy, and the site copy
// scan (tests/site/site-copy.test.ts) bans the word Cloudflare's config key uses.

/**
 * Cookieless page-view counting for the PUBLIC site only (Cloudflare Web Analytics).
 * It is mounted in app/welcome/layout.tsx and nowhere else: the signed-in app has no
 * third-party analytics (app/privacy/page.tsx says so).
 *
 * Off until NEXT_PUBLIC_CF_ANALYTICS_TOKEN is set in Netlify (the site token from
 * Cloudflare → Web Analytics → Add a site). The token is public by design.
 */
export default function SiteAnalytics() {
  const token = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN?.trim()
  if (!token || !/^[\w-]{8,64}$/.test(token)) return null
  return (
    <Script
      src="https://static.cloudflareinsights.com/beacon.min.js"
      strategy="afterInteractive"
      data-cf-beacon={JSON.stringify({ token, spa: true })}
    />
  )
}
