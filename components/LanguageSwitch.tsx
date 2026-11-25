'use client'

import { isEnglishEnabled, type Locale } from '@/lib/i18n'
import { useLocale, useT } from '@/lib/i18n/use-locale'

/**
 * 语言切换。英文开关关着时什么都不渲染，中文界面零变化。
 * 默认是设置页的卡片；compact 是登录页底部的一行小字（英文用户登录前就能切）。
 */
export default function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const [locale, setLocale] = useLocale()
  const t = useT()
  if (!isEnglishEnabled()) return null

  if (compact) {
    return (
      <div className="mt-8 flex justify-center gap-3 text-xs" aria-label={t('common.language.title')}>
        {(['zh', 'en'] as Locale[]).map(l => (
          <button key={l} type="button" onClick={() => setLocale(l)} aria-pressed={locale === l}
            className={locale === l ? 'font-medium text-black' : 'text-gray-400 underline'}>
            {t(l === 'zh' ? 'common.language.zh' : 'common.language.en')}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-4">
      <p className="text-sm font-semibold mb-3">{t('common.language.title')}</p>
      <div className="flex gap-2">
        {(['zh', 'en'] as Locale[]).map(l => (
          <button key={l} type="button" onClick={() => setLocale(l)}
            className={`flex-1 py-2 rounded-xl text-sm border transition-colors ${locale === l ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>
            {t(l === 'zh' ? 'common.language.zh' : 'common.language.en')}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-2">{t('common.language.note')}</p>
    </div>
  )
}
