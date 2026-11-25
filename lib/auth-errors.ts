import { translate, type Locale } from '@/lib/i18n'

/**
 * 登录 / 注册失败时给用户看的话。从 app/auth/page.tsx 搬出来以便测试；
 * 中文和改造前逐字一致。认不出的错误原样显示 Supabase 的英文原文（和以前一样）。
 */
export function getAuthErrorMessage(err: unknown, locale: Locale = 'zh'): string {
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? String(err.code)
    : ''
  const message = err instanceof Error ? err.message : translate(locale, 'auth.errors.fallback')

  if (code === 'email_address_not_authorized') return translate(locale, 'auth.errors.notAuthorized')
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return translate(locale, 'auth.errors.rateLimit')
  }
  if (code === 'email_not_confirmed' || message.includes('Email not confirmed')) {
    return translate(locale, 'auth.errors.notConfirmed')
  }
  if (code === 'invalid_credentials' || message.includes('Invalid login')) {
    return translate(locale, 'auth.errors.invalidCredentials')
  }
  if (message.includes('already registered')) return translate(locale, 'auth.errors.alreadyRegistered')
  return message
}
