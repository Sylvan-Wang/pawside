import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/onboarding'
  return value
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const next = safeNextPath(request.nextUrl.searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, request.url))
    console.error('auth callback exchange failed', { code: error.code })
  }

  return NextResponse.redirect(new URL('/auth/confirmation-failed', request.url))
}
