'use client'

import { useEffect } from 'react'
import { captureFirstTouch } from '@/lib/site/attribution'

/** Records where this browser first came from (see lib/site/attribution.ts). Renders nothing. */
export default function FirstTouch() {
  useEffect(() => {
    captureFirstTouch()
  }, [])
  return null
}
