// Helpers for index.js. Kept in their own module because a Netlify build plugin's
// index.js may only export event handlers (onSuccess…); any other export fails the build.
//
// After a successful PRODUCTION deploy, tell Bing (and the other IndexNow engines:
// Yandex, Seznam, Naver…) which public pages exist, so new 训练指南 articles get crawled
// within hours instead of days. Google and Baidu do not use IndexNow; they read the sitemap.
//
// The key is public by design: IndexNow checks it at https://paw-side.com/<key>.txt
// (public/<key>.txt, kept outside the auth proxy by its matcher in proxy.ts).
// A failure here only logs; it never fails the deploy.
export const INDEXNOW_KEY = 'bf6f6f523cba5dcce8d0115ef05204d3'
export const SITE = 'https://paw-side.com'

export function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1].trim())
    .filter((url) => url.startsWith(SITE))
}

