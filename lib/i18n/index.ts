import { zh, type Messages } from './messages/zh'
import { en } from './messages/en'

export type Locale = 'zh' | 'en'

export const LOCALE_STORAGE_KEY = 'pawside.locale'
export const LOCALE_CHANGE_EVENT = 'pawside:locale-change'

/**
 * 英文界面开关。默认关：关着的时候永远是中文，用户设置也不读。
 * 内测时在部署环境里设 NEXT_PUBLIC_I18N_EN=1。
 */
export function isEnglishEnabled(flag: string | undefined = process.env.NEXT_PUBLIC_I18N_EN): boolean {
  return flag === '1' || flag === 'true'
}

/** 开关关着一律中文；开着才看用户选的语言，看不懂的值也按中文。 */
export function resolveLocale(stored: unknown, enabled: boolean): Locale {
  if (!enabled) return 'zh'
  return stored === 'en' ? 'en' : 'zh'
}

const DICTS: Record<Locale, Messages> = { zh, en }

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never
type Paths<T> = { [K in keyof T]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T]

/** 所有合法的字典 key，例如 'common.nav.home'。写错 key tsc 会报错。 */
export type MessageKey = Paths<Messages>

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * 取文案。{name} 用 params 替换。
 * 英文缺某条时退回中文，绝不把 key 本身露给用户。
 */
export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const text = lookup(DICTS[locale], key) ?? lookup(zh, key) ?? ''
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

export function getMessages(locale: Locale): Messages {
  return DICTS[locale]
}
