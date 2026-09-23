import { describe, expect, it } from 'vitest'
import {
  applyAuthPersistence,
  AUTH_PERSISTENCE_MAX_AGE,
  authPersistenceFromCookie,
} from '../lib/supabase/auth-persistence'

describe('Supabase auth persistence', () => {
  it('defaults existing users to persistent sessions', () => {
    expect(authPersistenceFromCookie(undefined)).toBe('persistent')
    expect(authPersistenceFromCookie('persistent')).toBe('persistent')
  })

  it('removes expiry settings for a browser-session-only login', () => {
    expect(applyAuthPersistence({ path: '/', maxAge: 3600 }, 'session')).toEqual({
      path: '/',
    })
  })

  it('gives remembered sessions a persistent expiry', () => {
    expect(applyAuthPersistence({ path: '/' }, 'persistent')).toEqual({
      path: '/',
      maxAge: AUTH_PERSISTENCE_MAX_AGE,
    })
  })

  it('preserves deletion cookies for logout and revoked sessions', () => {
    expect(applyAuthPersistence({ path: '/', maxAge: 0 }, 'session')).toEqual({
      path: '/',
      maxAge: 0,
    })
  })
})
