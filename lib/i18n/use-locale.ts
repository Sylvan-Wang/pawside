'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  LOCALE_CHANGE_EVENT,
  LOCALE_STORAGE_KEY,
  isEnglishEnabled,
  resolveLocale,
  translate,
  type Locale,
  type MessageKey,
} from './index'

function readStoredLocale(): Locale {
  const enabled = isEnglishEnabled()
  if (!enabled || typeof window === 'undefined') return 'zh'
  try {
    return resolveLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY), enabled)
  } catch {
    return 'zh'
  }
}

/**
 * 当前界面语言。首次渲染一律中文（和服务端一致，避免水合不一致），
 * 开关打开时再读用户选的语言；别的组件改了语言会同步过来。
 */
export function useLocale(): [Locale, (next: Locale) => void] {
  const [locale, setLocaleState] = useState<Locale>('zh')

  useEffect(() => {
    if (!isEnglishEnabled()) return
    const sync = () => setLocaleState(readStoredLocale())
    sync()
    window.addEventListener(LOCALE_CHANGE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(LOCALE_CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const setLocale = useCallback((next: Locale) => {
    if (!isEnglishEnabled()) return
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      // 存不下也照样切换本页
    }
    setLocaleState(next)
    window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT))
  }, [])

  return [locale, setLocale]
}

/** 组件里取文案：const t = useT(); t('common.nav.home') */
export function useT() {
  const [locale] = useLocale()
  return useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  )
}
