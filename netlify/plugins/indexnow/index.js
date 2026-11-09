// After a successful PRODUCTION deploy, tell Bing (and the other IndexNow engines:
// Yandex, Seznam, Naver…) which public pages exist, so new 训练指南 articles get crawled
// within hours instead of days. Google and Baidu do not use IndexNow; they read the sitemap.
//
// The key is public by design: IndexNow checks it at https://paw-side.com/<key>.txt
// (public/<key>.txt, kept outside the auth proxy by its matcher in proxy.ts).
// A failure here only logs; it never fails the deploy.
export const INDEXNOW_KEY = 'bf6f6f523cba5dcce8d0115ef05204d3'
const SITE = 'https://paw-side.com'

export function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1].trim())
    .filter((url) => url.startsWith(SITE))
}

export const onSuccess = async () => {
  if (process.env.CONTEXT !== 'production') return
  try {
    const sitemap = await fetch(`${SITE}/sitemap.xml`)
    if (!sitemap.ok) throw new Error(`sitemap HTTP ${sitemap.status}`)
    const urlList = sitemapUrls(await sitemap.text())
    if (urlList.length === 0) throw new Error('sitemap has no URLs')
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(SITE).host, key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList }),
    })
    console.log(`IndexNow: submitted ${urlList.length} URLs, HTTP ${response.status}`)
  } catch (error) {
    console.warn(`IndexNow: skipped (${error instanceof Error ? error.message : error})`)
  }
}
