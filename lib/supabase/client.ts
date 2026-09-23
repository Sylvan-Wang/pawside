import {
  createBrowserClient,
  parseCookieHeader,
  serializeCookieHeader,
  type CookieOptions,
} from '@supabase/ssr'
import {
  applyAuthPersistence,
  AUTH_PERSISTENCE_COOKIE,
  AUTH_PERSISTENCE_MAX_AGE,
  authPersistenceFromCookie,
} from './auth-persistence'

function getBrowserCookies() {
  if (typeof document === 'undefined') return []
  return parseCookieHeader(document.cookie).flatMap(({ name, value }) =>
    value === undefined ? [] : [{ name, value }],
  )
}

function getBrowserAuthPersistence() {
  const preference = getBrowserCookies().find(
    cookie => cookie.name === AUTH_PERSISTENCE_COOKIE,
  )
  return authPersistenceFromCookie(preference?.value)
}

export function isSupabaseAuthCookie(name: string) {
  return /^sb-[a-z0-9]+-auth-token(?:[.][0-9]+)?$/i.test(name)
}

export function setAuthPersistence(rememberMe: boolean) {
  const value = rememberMe ? 'persistent' : 'session'
  const cookieOptions: CookieOptions = {
    path: '/',
    sameSite: 'lax',
    ...(rememberMe ? { maxAge: AUTH_PERSISTENCE_MAX_AGE } : {}),
  }

  document.cookie = serializeCookieHeader(
    AUTH_PERSISTENCE_COOKIE,
    value,
    cookieOptions,
  )

  // signIn writes the Supabase cookie asynchronously. Calling this once before
  // and once after signIn makes the selected lifetime explicit even if an
  // already-created browser client is re-used.
  getBrowserCookies()
    .filter(cookie => isSupabaseAuthCookie(cookie.name))
    .forEach(cookie => {
      document.cookie = serializeCookieHeader(
        cookie.name,
        cookie.value,
        cookieOptions,
      )
    })
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: getBrowserCookies,
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          const persistence = getBrowserAuthPersistence()
          cookiesToSet.forEach(({ name, value, options }) => {
            document.cookie = serializeCookieHeader(
              name,
              value,
              applyAuthPersistence(options, persistence),
            )
          })
        },
      },
    },
  )
}
