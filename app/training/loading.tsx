export default function TrainingLoading() {
  return (
    <div className="min-h-screen bg-gray-50" aria-live="polite" aria-busy="true">
      <div className="h-14 border-b border-gray-100 bg-white" />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <div className="h-28 animate-pulse rounded-2xl bg-neutral-900" />
        <div className="rounded-2xl bg-white p-4">
          <div className="h-3 w-20 animate-pulse rounded bg-gray-100" />
          <div className="mt-3 h-6 w-40 animate-pulse rounded bg-gray-200" />
          <div className="mt-4 aspect-square w-full animate-pulse rounded-xl bg-neutral-800" />
        </div>
      </main>
    </div>
  )
}
