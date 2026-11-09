/**
 * Where a visitor first came from, so we can count which channel brings sign-ups.
 *
 * Captured once, on the first public-site page a browser opens (components/site/FirstTouch.tsx),
 * kept in that browser's localStorage, and attached to the account at sign-up as
 * `user_metadata.signup_source` (app/auth/page.tsx). Nothing here identifies a person:
 * it is a channel name, the referring site's host name and the landing path.
 * Disclosed in app/privacy/page.tsx. Query: scripts/site/signup-sources.sql.
 */
export const FIRST_TOUCH_KEY = 'pawside.firstTouch.v1'

export interface FirstTouch {
  /** utm_source, else a known referrer (google, bing, baidu, xiaohongshu…), else the referrer host, else "direct". */
  source: string
  medium?: string
  campaign?: string
  /** Host name of the referring site, no path or query. */
  referrer?: string
  /** Path of the first site page opened, no query string. */
  landing: string
  /** ISO time of the first visit. */
  at: string
}

const KNOWN_REFERRERS: [RegExp, string][] = [
  [/(^|\.)google\./, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)baidu\.com$/, 'baidu'],
  [/(^|\.)(xiaohongshu\.com|xhslink\.com)$/, 'xiaohongshu'],
  [/(^|\.)(weixin\.qq\.com|wechat\.com)$/, 'wechat'],
  [/(^|\.)bilibili\.com$/, 'bilibili'],
  [/(^|\.)(zhihu\.com)$/, 'zhihu'],
  [/(^|\.)(douyin\.com)$/, 'douyin'],
  [/(^|\.)(sogou\.com)$/, 'sogou'],
  [/(^|\.)(so\.com)$/, '360'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
]

const clean = (value: string | null, max = 64) => {
  const text = value?.trim().toLowerCase().replace(/[^\w.\-]/g, '').slice(0, max)
  return text || undefined
}

function hostOf(referrer: string): string | undefined {
  try {
    return new URL(referrer).hostname.toLowerCase() || undefined
  } catch {
    return undefined
  }
}

/**
 * The first-touch record for this page view, or null when there is nothing worth keeping
 * (an internal navigation inside our own site with no campaign tags).
 */
export function deriveFirstTouch(pageUrl: URL, referrer: string, now: Date): FirstTouch | null {
  const params = pageUrl.searchParams
  const utmSource = clean(params.get('utm_source'))
  const refHost = hostOf(referrer)
  const internal = refHost !== undefined && refHost === pageUrl.hostname.toLowerCase()
  if (internal && !utmSource) return null

  const externalHost = internal ? undefined : refHost
  const known = externalHost ? KNOWN_REFERRERS.find(([pattern]) => pattern.test(externalHost))?.[1] : undefined
  return {
    source: utmSource ?? known ?? externalHost ?? 'direct',
    medium: clean(params.get('utm_medium')),
    campaign: clean(params.get('utm_campaign')),
    referrer: externalHost,
    landing: pageUrl.pathname.slice(0, 128),
    at: now.toISOString(),
  }
}

export function readFirstTouch(): FirstTouch | null {
  try {
    const raw = window.localStorage.getItem(FIRST_TOUCH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FirstTouch
    return typeof parsed?.source === 'string' && typeof parsed?.landing === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** Keeps the first record only: later visits never overwrite it. */
export function captureFirstTouch(): void {
  try {
    if (readFirstTouch()) return
    const touch = deriveFirstTouch(new URL(window.location.href), document.referrer, new Date())
    if (touch) window.localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(touch))
  } catch {
    // Private mode or blocked storage: we simply do not learn the source.
  }
}

/** Extra sign-up metadata; empty when the visitor never passed through the public site. */
export function signupSourceMetadata(): { signup_source?: FirstTouch } {
  const touch = typeof window === 'undefined' ? null : readFirstTouch()
  return touch ? { signup_source: touch } : {}
}
