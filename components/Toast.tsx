'use client'
import { useEffect, useState } from 'react'

interface ToastProps {
  message: string
  type?: 'success' | 'error'
  onClose: () => void
}

export function Toast({ message, type = 'success', onClose }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, 2500)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-white text-sm shadow-lg transition-all
      ${type === 'success' ? 'bg-gray-800' : 'bg-red-500'}`}>
      {message}
    </div>
  )
}

export function useToast() {
  const [toast, setToast] = useState<{ message: string; type?: 'success' | 'error' } | null>(null)
  const show = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type })
  const hide = () => setToast(null)
  const ToastEl = toast ? <Toast message={toast.message} type={toast.type} onClose={hide} /> : null
  return { show, ToastEl }
}
