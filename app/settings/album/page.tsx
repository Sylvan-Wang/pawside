'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { newClientId } from '@/lib/coach-chat/client'
import { addPhoto } from '@/lib/photos/client'
import {
  CATEGORY_LABEL,
  MAX_PHOTOS_PER_PICK,
  PHOTO_CATEGORIES,
  PICKABLE_CATEGORIES,
  type PhotoCategory,
  type PhotoView,
} from '@/lib/photos/constants'

type Tab = 'all' | PhotoCategory
const TABS: Tab[] = ['all', ...PHOTO_CATEGORIES]
const tabLabel = (tab: Tab) => (tab === 'all' ? '全部' : CATEGORY_LABEL[tab])

const EMPTY: Record<Tab, string> = {
  all: '还没有照片。在这里上传，或者在小爪里点 📷 发照片，都会存到这里。',
  body: '还没有身体记录照片。定期拍一张同角度的照片，比体重更能看出变化。',
  meal: '还没有饮食照片。',
  poster: '报告生成的分享海报会存在这里。',
  other: '还没有其他照片。',
}

interface ListResult { photos: PhotoView[]; has_more: boolean; counts?: Record<PhotoCategory, number> }

function formatDate(date: string) {
  const [, m, d] = date.split('-').map(Number)
  return `${m}月${d}日`
}

export default function AlbumPage() {
  const { show, ToastEl } = useToast()
  const [tab, setTab] = useState<Tab>('all')
  const [photos, setPhotos] = useState<PhotoView[]>([])
  const [counts, setCounts] = useState<Record<PhotoCategory, number> | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<File[]>([])
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [open, setOpen] = useState<PhotoView | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchPage = useCallback(async (which: Tab, before?: string): Promise<ListResult> => {
    const params = new URLSearchParams({ limit: '30' })
    if (which !== 'all') params.set('category', which)
    if (before) params.set('before', before)
    const response = await fetch(`/api/photos?${params}`, { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.data) throw new Error(payload?.error?.message ?? '相册暂时打不开')
    return payload.data as ListResult
  }, [])

  const load = useCallback(async (which: Tab) => {
    setState('loading')
    try {
      const data = await fetchPage(which)
      setPhotos(data.photos)
      setHasMore(data.has_more)
      if (data.counts) setCounts(data.counts)
      setError(null)
      setState('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '相册暂时打不开')
      setState('error')
    }
  }, [fetchPage])

  useEffect(() => { void Promise.resolve().then(() => load(tab)) }, [load, tab])

  async function loadMore() {
    const last = photos[photos.length - 1]
    if (!last) return
    try {
      const data = await fetchPage(tab, last.created_at)
      setPhotos((current) => [...current, ...data.photos])
      setHasMore(data.has_more)
    } catch (reason) {
      show(reason instanceof Error ? reason.message : '加载失败', 'error')
    }
  }

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, MAX_PHOTOS_PER_PICK)
    if ((event.target.files?.length ?? 0) > MAX_PHOTOS_PER_PICK) show(`一次最多 ${MAX_PHOTOS_PER_PICK} 张，先存前 ${MAX_PHOTOS_PER_PICK} 张`)
    event.target.value = ''
    if (files.length === 0) return
    if (tab !== 'all' && tab !== 'poster') void store(files, tab)
    else setPicked(files)
  }

  async function store(files: File[], category: PhotoCategory) {
    setPicked([])
    setUploading({ done: 0, total: files.length })
    let failed: string | null = null
    for (const [index, file] of files.entries()) {
      try {
        await addPhoto(file, { category, source: 'album', clientRequestId: newClientId() })
      } catch (reason) {
        failed = reason instanceof Error ? reason.message : '有照片没存上'
      }
      setUploading({ done: index + 1, total: files.length })
    }
    setUploading(null)
    if (failed) show(failed, 'error')
    else show(`已存进「${CATEGORY_LABEL[category]}」`)
    await load(tab)
  }

  async function move(photo: PhotoView, category: PhotoCategory) {
    setBusy(true)
    try {
      const response = await fetch(`/api/photos/${photo.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error?.message ?? '没改成功')
      setOpen(null)
      show(`已移到「${CATEGORY_LABEL[category]}」`)
      await load(tab)
    } catch (reason) {
      show(reason instanceof Error ? reason.message : '没改成功', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(photo: PhotoView) {
    if (!window.confirm('删除这张照片？删除后找不回来。')) return
    setBusy(true)
    try {
      const response = await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error?.message ?? '删除失败')
      setOpen(null)
      show('已删除')
      await load(tab)
    } catch (reason) {
      show(reason instanceof Error ? reason.message : '删除失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const total = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : null
  const countFor = (which: Tab) => (counts ? (which === 'all' ? total : counts[which]) : null)
  const canUpload = tab !== 'poster'

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      {ToastEl}
      <PageHeader title="我的相册" back />

      <div className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-gray-100 bg-white px-4 py-2" role="tablist" aria-label="相册分类">
        {TABS.map((which) => (
          <button
            key={which}
            type="button"
            role="tab"
            aria-selected={tab === which}
            onClick={() => setTab(which)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${tab === which ? 'bg-black text-white' : 'border border-gray-200 text-gray-600'}`}
          >
            {tabLabel(which)}{countFor(which) !== null ? ` ${countFor(which)}` : ''}
          </button>
        ))}
      </div>

      <div className="px-4 py-3">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={onPick} />
        {canUpload && !picked.length && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={Boolean(uploading)}
            className="mb-3 w-full rounded-xl border border-dashed border-gray-300 bg-white py-3 text-sm text-gray-700 disabled:opacity-50"
          >
            {uploading ? `正在上传 ${uploading.done}/${uploading.total}…` : `＋ 上传照片${tab === 'all' ? '' : `到「${CATEGORY_LABEL[tab]}」`}`}
          </button>
        )}
        {picked.length > 0 && (
          <div className="mb-3 rounded-2xl bg-white p-3" role="group" aria-label="选择相册">
            <p className="text-sm text-gray-700">{picked.length} 张照片，存到哪个相册？</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PICKABLE_CATEGORIES.map((category) => (
                <button key={category} type="button" onClick={() => void store(picked, category)}
                  className="rounded-full bg-black px-3 py-1 text-xs text-white">{CATEGORY_LABEL[category]}</button>
              ))}
              <button type="button" onClick={() => setPicked([])} className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-500">取消</button>
            </div>
          </div>
        )}

        {state === 'loading' && <p className="py-10 text-center text-sm text-gray-400">加载中…</p>}
        {state === 'error' && (
          <div className="py-10 text-center">
            <p className="text-sm text-gray-500">{error}</p>
            <button type="button" onClick={() => void load(tab)} className="mt-3 rounded-full border border-gray-200 px-4 py-1.5 text-sm text-gray-700">重试</button>
          </div>
        )}
        {state === 'ready' && photos.length === 0 && <p className="py-10 text-center text-sm text-gray-400">{EMPTY[tab]}</p>}
        {state === 'ready' && photos.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-1">
              {photos.map((photo) => (
                <button key={photo.id} type="button" onClick={() => setOpen(photo)}
                  className="relative aspect-square overflow-hidden rounded-lg bg-gray-200" aria-label={`${CATEGORY_LABEL[photo.category]}，${formatDate(photo.local_date)}`}>
                  {photo.url
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs; next/image would cache them
                    ? <img src={photo.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    : <span className="text-[11px] text-gray-400">加载不出</span>}
                  {tab === 'all' && (
                    <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1 text-[10px] text-white">{CATEGORY_LABEL[photo.category]}</span>
                  )}
                </button>
              ))}
            </div>
            {hasMore && (
              <button type="button" onClick={() => void loadMore()} className="mx-auto mt-4 block text-xs text-gray-500">加载更多</button>
            )}
          </>
        )}
        <p className="mt-6 text-center text-[11px] text-gray-400">照片只有你自己看得到，不会发给 AI。删除账号时会一起删除。</p>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="照片">
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="text-sm">{CATEGORY_LABEL[open.category]} · {formatDate(open.local_date)}</span>
            <button type="button" onClick={() => setOpen(null)} className="text-2xl leading-none" aria-label="关闭">×</button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden">
            {open.url
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs
              ? <img src={open.url} alt={`${CATEGORY_LABEL[open.category]}照片`} className="max-h-full max-w-full object-contain" />
              : <p className="text-sm text-gray-400">这张照片暂时加载不出来</p>}
          </div>
          <div className="space-y-3 bg-black px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            {open.source !== 'report' && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400">移到</span>
                {PICKABLE_CATEGORIES.filter((category) => category !== open.category).map((category) => (
                  <button key={category} type="button" disabled={busy} onClick={() => void move(open, category)}
                    className="rounded-full border border-white/30 px-3 py-1 text-xs text-white disabled:opacity-40">{CATEGORY_LABEL[category]}</button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              {open.url && (
                <a href={open.url} target="_blank" rel="noopener noreferrer" download
                  className="flex-1 rounded-xl border border-white/30 py-2.5 text-center text-sm text-white">保存原图</a>
              )}
              <button type="button" disabled={busy} onClick={() => void remove(open)}
                className="flex-1 rounded-xl border border-red-400/60 py-2.5 text-sm text-red-300 disabled:opacity-40">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
