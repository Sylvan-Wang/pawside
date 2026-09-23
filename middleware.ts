import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  applyAuthPersistence,
  AUTH_PERSISTENCE_COOKIE,
  authPersistenceFromCookie,
} from '@/lib/supabase/auth-persistence'

function redirectWithAuthCookies(url: URL, authResponse: NextResponse) {
  const redirectResponse = NextResponse.redirect(url)
  authResponse.cookies.getAll().forEach(cookie => {
    redirectResponse.cookies.set(cookie)
  })
  return redirectResponse
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const persistence = authPersistenceFromCookie(
    request.cookies.get(AUTH_PERSISTENCE_COOKIE)?.value,
  )

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(
              name,
              value,
              applyAuthPersistence(options, persistence),
            )
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  const publicPaths = ['/auth']
  const isPublic = publicPaths.some(p => pathname.startsWith(p)) || pathname === '/auth/reset-password'

  if (!user && !isPublic && !pathname.startsWith('/api')) {
    return redirectWithAuthCookies(new URL('/auth', request.url), supabaseResponse)
  }

  if (user && pathname === '/auth') {
    return redirectWithAuthCookies(new URL('/home', request.url), supabaseResponse)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
