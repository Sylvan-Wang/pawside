import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/onboarding'
  return value
}

function redirectUrl(path: string, request: NextRequest): URL {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configuredSiteUrl) {
    try {
      return new URL(path, configuredSiteUrl)
    } catch {
      console.error('invalid NEXT_PUBLIC_SITE_URL')
    }
  }
  return new URL(path, request.nextUrl.origin)
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const next = safeNextPath(request.nextUrl.searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(redirectUrl(next, request))
    console.error('auth callback exchange failed', { code: error.code })
  }

  return NextResponse.redirect(redirectUrl('/auth/confirmation-failed', request))
}
