const BILIBILI_VIDEO = /^https:\/\/(www\.|m\.)?bilibili\.com\/video\/[A-Za-z0-9]+/

/**
 * The tutorial link an exercise card may show. Hidden unless the link was verified
 * (publisher account + page opens) and is a plain https Bilibili video URL.
 */
export function visibleTutorialUrl(
  url: string | null | undefined,
  verifiedAt: string | null | undefined,
): string | null {
  if (!url || !verifiedAt) return null
  return BILIBILI_VIDEO.test(url) ? url : null
}
