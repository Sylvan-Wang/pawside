import type { CookieOptions } from '@supabase/ssr'

export const AUTH_PERSISTENCE_COOKIE = 'pawside-auth-persistence'
export const AUTH_PERSISTENCE_MAX_AGE = 400 * 24 * 60 * 60

export type AuthPersistence = 'persistent' | 'session'

export function authPersistenceFromCookie(value?: string): AuthPersistence {
  return value === 'session' ? 'session' : 'persistent'
}

export function applyAuthPersistence(
  options: CookieOptions = {},
  persistence: AuthPersistence,
): CookieOptions {
  if (options.maxAge === 0) return options

  if (persistence === 'session') {
    const sessionOptions = { ...options }
    delete sessionOptions.maxAge
    delete sessionOptions.expires
    return sessionOptions
  }

  return {
    ...options,
    maxAge: options.maxAge ?? AUTH_PERSISTENCE_MAX_AGE,
  }
}
