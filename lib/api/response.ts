import { NextResponse } from 'next/server'

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_JSON'
  | 'VALIDATION_ERROR'
  | 'METHOD_NOT_READY'
  | 'ONBOARDING_INCOMPLETE'
  | 'NOT_ENROLLED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_PROVIDER_ERROR'
  | 'DATABASE_ERROR'

export function apiError(code: ApiErrorCode, message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status }
  )
}
