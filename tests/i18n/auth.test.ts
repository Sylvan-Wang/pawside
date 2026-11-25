import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getAuthErrorMessage } from '@/lib/auth-errors'
import { translate } from '@/lib/i18n'

const err = (code: string, message = 'x') => Object.assign(new Error(message), { code })

describe('登录注册的错误提示', () => {
  it('中文和改造前逐字一致', () => {
    expect(getAuthErrorMessage(err('email_address_not_authorized'))).toBe('当前邮件服务无法向这个邮箱发送确认邮件，请联系管理员配置正式邮件服务')
    expect(getAuthErrorMessage(err('over_email_send_rate_limit'))).toBe('确认邮件发送过于频繁，请至少等待 60 秒后再试')
    expect(getAuthErrorMessage(err('over_request_rate_limit'))).toBe('确认邮件发送过于频繁，请至少等待 60 秒后再试')
    expect(getAuthErrorMessage(new Error('Email not confirmed'))).toBe('邮箱尚未验证，请检查收件箱并点击确认链接')
    expect(getAuthErrorMessage(err('invalid_credentials'))).toBe('邮箱或密码错误')
    expect(getAuthErrorMessage(new Error('Invalid login credentials'))).toBe('邮箱或密码错误')
    expect(getAuthErrorMessage(new Error('User already registered'))).toBe('该邮箱已注册，请直接登录')
    expect(getAuthErrorMessage('oops')).toBe('操作失败')
  })

  it('认不出的错误原样显示（两种语言都一样）', () => {
    expect(getAuthErrorMessage(new Error('Network down'))).toBe('Network down')
    expect(getAuthErrorMessage(new Error('Network down'), 'en')).toBe('Network down')
  })

  it('英文模式给英文', () => {
    expect(getAuthErrorMessage(err('invalid_credentials'), 'en')).toBe('Wrong email or password')
    expect(getAuthErrorMessage('oops', 'en')).toBe('Something went wrong')
  })
})

describe('登录注册页面的中文', () => {
  it('字典里的中文和改造前页面上的原文一致', () => {
    const zh = (k: Parameters<typeof translate>[1]) => translate('zh', k)
    expect(zh('auth.brand')).toBe('爪边 Pawside')
    expect(zh('auth.rememberMe')).toBe('记住我，后续不再重复登录')
    // 条款那一句是拼起来的，拼完要和原来一样
    expect(zh('auth.agreeRegister') + zh('auth.terms') + zh('auth.and') + zh('auth.privacy') + zh('auth.agreeEnd'))
      .toBe('注册即表示你已阅读并同意服务条款和隐私政策。')
    expect(zh('auth.agreeLogin')).toBe('使用爪边即表示你同意')
    expect(zh('auth.pendingBody')).toBe('如果该邮箱可以注册，确认邮件已经发送。请从邮件链接返回 Pawside。')
    expect(zh('auth.confirmFailed.body')).toBe('确认链接无效或已经过期。请返回登录；如果还没有完成注册，可以重新提交邮箱。')
  })

  it('四个页面不再写死中文（文案都走字典）', () => {
    for (const p of ['app/auth/page.tsx', 'app/auth/forgot-password/page.tsx', 'app/auth/reset-password/page.tsx', 'app/auth/confirmation-failed/page.tsx', 'lib/auth-errors.ts']) {
      const code = readFileSync(p, 'utf8')
        .split('\n')
        .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.includes('{/*'))
        .join('\n')
      expect(code.match(/['"`>][^'"`<]*[一-龥][^'"`<]*['"`<]/g), p).toBeNull()
    }
  })

  it('登录页的语言切换在开关关着时不渲染（组件自己判断，页面不包额外的容器）', () => {
    const page = readFileSync('app/auth/page.tsx', 'utf8')
    expect(page).toContain('<LanguageSwitch compact />')
    const comp = readFileSync('components/LanguageSwitch.tsx', 'utf8')
    expect(comp.indexOf('if (!isEnglishEnabled()) return null')).toBeLessThan(comp.indexOf('if (compact)'))
  })
})
