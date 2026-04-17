'use client'
// Wrapper that skips SSR entirely — prevents React hydration errors
// caused by Cloudflare injecting <script> tags into <body> at the CDN level.
import dynamic from 'next/dynamic'

const FoodPageClient = dynamic(
  () => import('./FoodPageClient'),
  {
    ssr: false,
    loading: () => <div className="min-h-screen bg-gray-50" />,
  }
)

export default function FoodPage() {
  return <FoodPageClient />
}
