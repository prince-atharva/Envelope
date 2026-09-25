import { Logo } from '../brand/Logo';

/**
 * Layout-stable skeletons that prevent layout shifts and flickering
 * during initial loads and page transitions.
 */

const SKELETON_KEYS = ['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5', 'sk-6', 'sk-7', 'sk-8'];

/** An indeterminate hairline along the top of the viewport, for loads behind a visible page. */
export function TopProgressBar() {
  return (
    <div
      className="fixed top-0 inset-x-0 z-50 h-0.5 overflow-hidden bg-brand-100/40 pointer-events-none"
      aria-hidden="true"
    >
      <div className="h-full w-full bg-linear-to-r from-brand-600 via-emerald-400 to-teal-500 origin-left animate-progress" />
    </div>
  );
}

export function DocumentListSkeleton({ rows = 5 }: { rows?: number }) {
  const keys = SKELETON_KEYS.slice(0, Math.min(rows, SKELETON_KEYS.length));
  return (
    <div
      className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs"
      aria-hidden="true"
    >
      {keys.map((key) => (
        <div
          key={key}
          className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
        >
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="hidden sm:block h-10 w-10 shrink-0 rounded-lg bg-slate-100 animate-pulse" />
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2.5">
                <div className="h-4 w-44 sm:w-64 rounded bg-slate-200/80 animate-pulse" />
                <div className="h-4 w-16 rounded-full bg-slate-100 animate-pulse" />
              </div>
              <div className="h-3 w-36 sm:w-52 rounded bg-slate-100 animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0 sm:self-center">
            <div className="space-y-1 sm:text-right">
              <div className="h-3 w-20 sm:ml-auto rounded bg-slate-200/70 animate-pulse" />
              <div className="h-2.5 w-16 sm:ml-auto rounded bg-slate-100 animate-pulse" />
            </div>
            <div className="hidden sm:block h-4 w-4 rounded bg-slate-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for Settings → Users page: header + stats bar + user rows. */
export function UsersPageSkeleton({ rows = 3 }: { rows?: number }) {
  const keys = SKELETON_KEYS.slice(0, Math.min(rows, SKELETON_KEYS.length));
  return (
    <div className="space-y-6 pb-8" aria-hidden="true">
      {/* Header row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="h-8 w-24 rounded-lg bg-slate-200/80 animate-pulse" />
          <div className="h-4 w-72 rounded bg-slate-100 animate-pulse" />
        </div>
        <div className="h-10 w-36 rounded-lg bg-brand-100/60 animate-pulse shrink-0" />
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-xs">
        <div className="h-9 w-9 rounded-xl bg-slate-100 animate-pulse shrink-0" />
        <div className="space-y-1.5">
          <div className="h-4 w-20 rounded bg-slate-200/80 animate-pulse" />
          <div className="h-3 w-40 rounded bg-slate-100 animate-pulse" />
        </div>
      </div>

      {/* User list rows */}
      <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        {keys.map((key) => (
          <div
            key={key}
            className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
          >
            <div className="flex items-center gap-4 min-w-0">
              {/* Avatar circle */}
              <div className="hidden sm:block h-11 w-11 shrink-0 rounded-full bg-slate-200/80 animate-pulse" />
              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-36 sm:w-48 rounded bg-slate-200/80 animate-pulse" />
                  <div className="h-4 w-10 rounded-full bg-slate-100 animate-pulse" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-3 w-40 sm:w-56 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-32 rounded bg-slate-100/70 animate-pulse hidden sm:block" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="h-8 w-24 rounded-lg bg-slate-100 animate-pulse" />
              <div className="h-8 w-8 rounded-lg bg-slate-100/70 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EnvelopeDetailSkeleton() {
  return (
    <div
      className="flex-1 flex flex-col space-y-6 max-w-7xl mx-auto w-full pb-12"
      aria-hidden="true"
    >
      {/* 1. Header Bar Skeleton */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between bg-white border border-slate-200/90 rounded-2xl p-4 sm:px-6 sm:py-4 shadow-xs">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-32 rounded bg-slate-100 animate-pulse" />
          <div className="flex items-center gap-2.5">
            <div className="h-6 w-60 sm:w-80 rounded-md bg-slate-200/80 animate-pulse" />
            <div className="h-5 w-20 rounded-full bg-slate-100 animate-pulse" />
          </div>
          <div className="h-3 w-48 rounded bg-slate-100 animate-pulse" />
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <div className="h-8 w-24 rounded-lg bg-slate-100 animate-pulse" />
          <div className="h-8 w-32 rounded-lg bg-brand-100/60 animate-pulse" />
        </div>
      </div>

      {/* 2. Document and sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main PDF Canvas Skeleton */}
        <div className="lg:col-span-7 xl:col-span-8 bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden h-[78vh] max-h-225 sm:min-h-160 flex flex-col items-center justify-center bg-slate-50/60 p-8">
          <div className="h-10 w-10 rounded-full bg-slate-200/80 animate-pulse mb-3" />
          <div className="h-3.5 w-44 rounded bg-slate-200/70 animate-pulse" />
        </div>

        {/* Right Inspector Sidebar Skeleton */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col space-y-5">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-3">
            <div className="h-4 w-36 rounded bg-slate-200/80 animate-pulse mb-1" />
            <div className="h-11 w-full rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
            <div className="h-11 w-full rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
          </div>
          <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-3">
            <div className="h-4 w-32 rounded bg-slate-200/80 animate-pulse mb-1" />
            <div className="h-16 w-full rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReviewPageSkeleton() {
  return (
    <div
      className="flex flex-1 flex-col space-y-6 max-w-7xl mx-auto w-full pb-12"
      aria-hidden="true"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between bg-white border border-slate-200/90 rounded-2xl p-4 sm:px-6 sm:py-4 shadow-xs">
        <div className="space-y-2 flex-1">
          <div className="h-3 w-36 rounded bg-slate-100 animate-pulse" />
          <div className="h-6 w-64 rounded bg-slate-200/80 animate-pulse" />
          <div className="h-3 w-48 rounded bg-slate-100 animate-pulse" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-9 w-28 rounded-xl bg-slate-100 animate-pulse" />
          <div className="h-9 w-32 rounded-xl bg-brand-100/60 animate-pulse" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="h-5 w-48 rounded bg-slate-200/80 animate-pulse" />
          <div className="h-24 w-full rounded-xl bg-slate-50 animate-pulse" />
          <div className="h-24 w-full rounded-xl bg-slate-50 animate-pulse" />
        </div>
        <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="h-5 w-36 rounded bg-slate-200/80 animate-pulse" />
          <div className="h-32 w-full rounded-xl bg-slate-50 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/** Complete Dashboard page skeleton with stable header, tabs, search, and list. */
export function DashboardSkeleton() {
  return (
    <div
      className="flex-1 flex flex-col space-y-6 max-w-7xl mx-auto w-full pb-12"
      aria-hidden="true"
    >
      {/* 1. Greeting & Action Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <div className="h-8 w-44 rounded-lg bg-slate-200/80 animate-pulse" />
          <div className="h-4 w-72 sm:w-96 rounded bg-slate-100 animate-pulse" />
        </div>
        <div className="h-10 w-36 sm:w-40 rounded-xl bg-brand-100/60 animate-pulse shrink-0" />
      </div>

      {/* 2. Tabs Bar Skeleton */}
      <div className="flex gap-4 border-b border-slate-200 pb-2">
        <div className="h-7 w-20 rounded-lg bg-brand-100/70 animate-pulse" />
        <div className="h-7 w-32 rounded-lg bg-slate-100 animate-pulse" />
        <div className="h-7 w-36 rounded-lg bg-slate-100 animate-pulse" />
        <div className="h-7 w-24 rounded-lg bg-slate-100 animate-pulse" />
        <div className="h-7 w-28 rounded-lg bg-slate-100 animate-pulse" />
      </div>

      {/* 3. Search and Sort Toolbar Skeleton */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="h-10 w-full max-w-md rounded-lg bg-slate-100 animate-pulse" />
        <div className="h-8 w-36 rounded-lg bg-slate-100 animate-pulse" />
      </div>

      {/* 4. Document List Skeleton */}
      <DocumentListSkeleton rows={5} />
    </div>
  );
}

/** The signed-in frame, shown while the session is being restored. */
export function AppShellSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50/50" aria-hidden="true">
      <TopProgressBar />

      {/* Matches AppShell's header, so nothing jumps when it arrives. */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-md shadow-2xs">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Logo />
            <div className="hidden sm:flex items-center gap-1.5">
              <div className="h-7 w-24 rounded-lg bg-brand-50 animate-pulse" />
              <div className="h-7 w-16 rounded-lg bg-slate-100 animate-pulse" />
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="h-8 w-32 rounded-lg bg-slate-100 animate-pulse hidden md:block" />
            <div className="h-8 w-36 rounded-lg bg-slate-100 animate-pulse" />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6 sm:py-6 flex flex-col min-h-0">
        <DashboardSkeleton />
      </main>
    </div>
  );
}

export function PreparePageSkeleton() {
  return (
    <div
      className="flex flex-1 flex-col space-y-4 max-w-7xl mx-auto w-full pb-10 min-h-0"
      aria-hidden="true"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between bg-white border border-slate-200/90 rounded-2xl p-4 sm:px-6 sm:py-3.5 shadow-xs">
        <div className="space-y-1.5 flex-1">
          <div className="h-3 w-36 rounded bg-slate-100 animate-pulse" />
          <div className="h-6 w-60 rounded bg-slate-200/80 animate-pulse" />
          <div className="h-3 w-48 rounded bg-slate-100 animate-pulse" />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-24 rounded-xl bg-slate-100 animate-pulse" />
          <div className="h-9 w-36 rounded-xl bg-brand-100/60 animate-pulse" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start flex-1 min-h-0">
        <div className="lg:col-span-4 xl:col-span-4 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-4">
          <div className="h-9 w-full rounded-xl bg-slate-100 animate-pulse" />
          <div className="h-28 w-full rounded-xl bg-slate-50 animate-pulse" />
          <div className="space-y-2">
            <div className="h-11 w-full rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
            <div className="h-11 w-full rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
            <div className="h-11 w-full rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
          </div>
        </div>
        <div className="lg:col-span-8 xl:col-span-8 bg-white border border-slate-200/90 rounded-2xl shadow-xs h-[80vh] max-h-230 sm:min-h-165 bg-slate-50/60 flex flex-col items-center justify-center p-8">
          <div className="h-10 w-10 rounded-full bg-slate-200/80 animate-pulse mb-3" />
          <div className="h-3.5 w-44 rounded bg-slate-200/70 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
