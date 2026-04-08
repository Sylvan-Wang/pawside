import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '爪边 Pawside',
    short_name: '爪边',
    description: '移动端健身记录 App',
    start_url: '/home',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#111111',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
