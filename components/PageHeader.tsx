'use client'
import { useRouter } from 'next/navigation'

interface PageHeaderProps {
  title: string
  back?: boolean
}

export default function PageHeader({ title, back }: PageHeaderProps) {
  const router = useRouter()
  return (
    <div className="flex items-center h-12 px-4 bg-white border-b border-gray-100">
      {back && (
        <button onClick={() => router.back()} className="mr-3 text-gray-500 text-lg">
          ←
        </button>
      )}
      <h1 className="text-base font-semibold text-gray-900">{title}</h1>
    </div>
  )
}
