import type { Metadata } from 'next'

// Login and sign-up pages carry no content worth indexing.
export const metadata: Metadata = { robots: { index: false, follow: true } }

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
