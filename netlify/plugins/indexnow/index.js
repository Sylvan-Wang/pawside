// Netlify build plugin: only event handlers may be exported from this file.
import { INDEXNOW_KEY, SITE, sitemapUrls } from './indexnow.js'

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
