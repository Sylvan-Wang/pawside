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

export async function proxy(request: NextRequest) {
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

  const publicPaths = ['/auth', '/privacy', '/terms', '/welcome', '/og']
  const isPublic = publicPaths.some(p => pathname.startsWith(p)) || pathname === '/auth/reset-password'
  const isLocalMethodPreview =
    process.env.PAWSIDE_VISUAL_PREVIEW === '1' &&
    (pathname.startsWith('/training/method') || pathname === '/onboarding')

  // The public site lives at the bare domain: logged-out visitors (and search engines) get the
  // homepage served at "/" itself; the old /welcome address moves there permanently.
  if (pathname === '/welcome') {
    const target = new URL('/', request.url)
    target.search = request.nextUrl.search
    const moved = NextResponse.redirect(target, 308)
    supabaseResponse.cookies.getAll().forEach((cookie) => moved.cookies.set(cookie))
    return moved
  }
  if (!user && pathname === '/') {
    const homepage = NextResponse.rewrite(new URL('/welcome', request.url))
    supabaseResponse.cookies.getAll().forEach((cookie) => homepage.cookies.set(cookie))
    return homepage
  }

  if (!user && !isPublic && !isLocalMethodPreview && !pathname.startsWith('/api')) {
    return redirectWithAuthCookies(new URL('/auth', request.url), supabaseResponse)
  }

  if (user && pathname === '/auth') {
    return redirectWithAuthCookies(new URL('/home', request.url), supabaseResponse)
  }

  return supabaseResponse
}

export const config = {
  // Every API route performs its own authenticated user check. Keeping API
  // requests out of this page redirect proxy removes a duplicate Supabase
  // getUser round trip from every data request. PWA metadata and icons must
  // also remain public so browsers can install Pawside before authentication,
  // and so must the cat stickers, which the public homepage shows too.
  matcher: [
    '/((?!api(?:/|$)|_next/static|_next/image|favicon(?:\\.ico|\\.svg)|icon\\.svg|apple-touch-icon(?:-\\d+x\\d+)?\\.png|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|coach-cat/).*)',
  ],
}
