import { Logo } from '../brand/Logo';
import { AppFooter } from '../layout/AppFooter';

/**
 * Layout-stable skeletons that prevent layout shifts and flickering
 * during initial loads and page transitions.
 *
 * Each one is built from the same layout classes as the page it stands in for
 * (`page-stack`, `page-heading`, `surface`) and the same control heights, so
 * the real page replaces it without anything moving. Change a page's layout
 * and change its skeleton with it.
 */

const SKELETON_KEYS = ['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5', 'sk-6', 'sk-7', 'sk-8'];

const TONES = {
  dark: 'bg-slate-200/80',
  light: 'bg-slate-100',
  brand: 'bg-brand-100/70',
  brandSoft: 'bg-brand-50',
} as const;

/** One placeholder block. `tone` picks the text-like grey, the lighter surface grey, or a brand tint. */
function Bone({
  className = '',
  tone = 'dark',
}: {
  className?: string;
  tone?: keyof typeof TONES;
}) {
  return <div className={`animate-pulse rounded ${TONES[tone]} ${className}`} />;
}

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

/** The page heading: optional back link, title, description, and a row of 44px actions. */
function HeadingSkeleton({
  actions = [],
  back = false,
  badge = false,
  flat = false,
  description = true,
}: {
  actions?: string[];
  back?: boolean;
  badge?: boolean;
  flat?: boolean;
  description?: boolean;
}) {
  return (
    <div className="page-heading" data-flat={flat || undefined}>
      <div className="min-w-0 flex-1 basis-64 space-y-3">
        {back && <Bone className="h-4 w-36" tone="light" />}
        <div className="flex flex-wrap items-center gap-2.5">
          <Bone className="h-9 w-52 sm:w-72 rounded-lg" />
          {badge && <Bone className="h-6 w-20 rounded-full" tone="light" />}
        </div>
        {description && <Bone className="h-4 w-64 sm:w-96" tone="light" />}
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {actions.map((width, index) => (
            <Bone
              // The row is fixed per skeleton and never reorders.
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
              key={index}
              className={`h-11 ${width} rounded-lg`}
              tone={index === actions.length - 1 ? 'brand' : 'light'}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** An underline tab row, like Documents and Settings use. */
function TabsSkeleton({ widths }: { widths: string[] }) {
  return (
    <div className="flex gap-4 border-b border-slate-200">
      {widths.map((width, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
          key={index}
          className="flex min-h-11 shrink-0 items-end px-2 pb-2.5"
        >
          <Bone className={`h-4 ${width}`} tone={index === 0 ? 'dark' : 'light'} />
        </div>
      ))}
    </div>
  );
}

/** A card with a title row and some body blocks, the shape the side panels share. */
function CardSkeleton({
  blocks = ['h-12'],
  title = 'w-36',
}: {
  blocks?: string[];
  title?: string;
}) {
  return (
    <div className="surface space-y-4 p-5">
      <div className="flex items-center gap-3">
        <Bone className="h-8 w-8 rounded-lg" tone="light" />
        <Bone className={`h-5 ${title}`} />
      </div>
      {blocks.map((height, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
        <Bone key={index} className={`${height} w-full rounded-lg`} tone="light" />
      ))}
    </div>
  );
}

/** A PDF viewer card: toolbar over a grey canvas holding one white page. */
function ViewerSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`surface flex min-w-0 flex-col overflow-hidden ${className}`}>
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <Bone className="h-5 w-28" tone="light" />
        <Bone className="h-8 w-32 rounded-lg" tone="light" />
      </div>
      <div className="flex flex-1 justify-center bg-slate-100 p-6">
        <div className="h-full min-h-64 w-full max-w-2xl animate-pulse rounded bg-white" />
      </div>
    </div>
  );
}

export function DocumentListSkeleton({ rows = 5 }: { rows?: number }) {
  const keys = SKELETON_KEYS.slice(0, Math.min(rows, SKELETON_KEYS.length));
  return (
    <div className="surface divide-y divide-slate-200 overflow-hidden" aria-hidden="true">
      {keys.map((key) => (
        <div
          key={key}
          className="flex flex-col gap-3 px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between"
        >
          <div className="flex min-w-0 items-start gap-3.5">
            <Bone className="hidden h-10 w-10 shrink-0 rounded-lg sm:block" tone="light" />
            <div className="min-w-0 space-y-2">
              <Bone className="h-4 w-44 sm:w-64" />
              <Bone className="h-3 w-36 sm:w-52" tone="light" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Bone className="h-3 w-28" tone="light" />
            <Bone className="h-5 w-14 rounded-full" tone="light" />
            <Bone className="hidden h-4 w-4 sm:block" tone="light" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The template library: a two-column grid of cards, not a list. */
export function TemplateGridSkeleton({ cards = 4 }: { cards?: number }) {
  const keys = SKELETON_KEYS.slice(0, Math.min(cards, SKELETON_KEYS.length));
  return (
    <div className="grid gap-5 xl:grid-cols-2" aria-hidden="true">
      {keys.map((key) => (
        <div key={key} className="surface flex min-w-0 flex-col gap-5 p-5 sm:p-6">
          <div className="space-y-3">
            <Bone className="h-11 w-11 rounded-lg" tone="light" />
            <Bone className="h-5 w-56" />
            <Bone className="h-4 w-full max-w-sm" tone="light" />
            <Bone className="h-3 w-40" tone="light" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Bone className="h-11 w-28 rounded-lg" tone="light" />
            <Bone className="h-11 w-32 rounded-lg" tone="light" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for Settings → Users: heading, settings tabs, count strip and member rows. */
export function UsersPageSkeleton({ rows = 3 }: { rows?: number }) {
  const keys = SKELETON_KEYS.slice(0, Math.min(rows, SKELETON_KEYS.length));
  return (
    <div className="page-stack" aria-hidden="true">
      <HeadingSkeleton flat actions={['w-36']} />
      <TabsSkeleton widths={['w-20', 'w-12']} />

      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
        <Bone className="h-9 w-9 shrink-0 rounded-xl" tone="light" />
        <div className="space-y-2">
          <Bone className="h-4 w-20" />
          <Bone className="h-3 w-40" tone="light" />
        </div>
      </div>

      <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {keys.map((key) => (
          <div
            key={key}
            className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
          >
            <div className="flex min-w-0 items-center gap-4">
              <Bone className="hidden h-11 w-11 shrink-0 rounded-full sm:block" />
              <div className="min-w-0 space-y-2">
                <Bone className="h-4 w-36 sm:w-48" />
                <Bone className="h-3 w-40 sm:w-56" tone="light" />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Bone className="h-11 w-28 rounded-lg" tone="light" />
              <Bone className="h-11 w-11 rounded-lg" tone="light" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EnvelopeDetailSkeleton() {
  return (
    <div className="page-stack flex-1" aria-hidden="true">
      <HeadingSkeleton back badge actions={['w-40', 'w-28', 'w-32', 'w-40']} />
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          <ViewerSkeleton className="h-[70vh] min-h-112" />
        </div>
        <div className="flex min-w-0 flex-col space-y-5 xl:col-span-4">
          <CardSkeleton title="w-32" blocks={['h-16', 'h-11']} />
          <CardSkeleton title="w-44" blocks={['h-24', 'h-4']} />
          <CardSkeleton title="w-28" blocks={['h-14', 'h-14']} />
        </div>
      </div>
    </div>
  );
}

export function ReviewPageSkeleton() {
  return (
    <div className="page-stack flex-1" aria-hidden="true">
      <HeadingSkeleton back badge actions={['w-28', 'w-36', 'w-44']} />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col space-y-5 lg:col-span-5">
          <CardSkeleton title="w-40" blocks={['h-10', 'h-20', 'h-10']} />
          <CardSkeleton title="w-28" blocks={['h-24', 'h-4', 'h-4']} />
        </div>
        <div className="flex min-w-0 flex-col space-y-4 lg:col-span-7">
          <CardSkeleton title="w-44" blocks={['h-36', 'h-36']} />
        </div>
      </div>
    </div>
  );
}

/** Complete Dashboard page skeleton with stable header, tabs, search, and list. */
export function DashboardSkeleton() {
  return (
    <div className="page-stack" aria-hidden="true">
      <HeadingSkeleton flat actions={['w-44']} />
      <TabsSkeleton widths={['w-28', 'w-20', 'w-24', 'w-24', 'w-16', 'w-12']} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Bone className="h-11 w-full max-w-md rounded-lg" tone="light" />
        <Bone className="h-11 w-52 rounded-lg" tone="light" />
      </div>
      <DocumentListSkeleton rows={5} />
    </div>
  );
}

/** Settings -> Branding: heading, tabs, two stacked cards and the preview beside them. */
export function BrandingPageSkeleton() {
  return (
    <div className="page-stack" aria-hidden="true">
      <HeadingSkeleton flat />
      <TabsSkeleton widths={['w-24', 'w-16', 'w-12']} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <Bone className="h-64 w-full rounded-xl" tone="light" />
      </div>
    </div>
  );
}

/** The signed-in frame, shown while the session is being restored: sidebar, header, footer. */
export function AppShellSkeleton() {
  return (
    <div className="min-h-dvh bg-slate-50" aria-hidden="true">
      <TopProgressBar />

      {/* Matches AppShell's sidebar, so nothing jumps when it arrives. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-slate-200 px-5">
          <Logo />
        </div>
        <div className="space-y-1 px-3 pt-4">
          <Bone className="h-11 w-full rounded-lg" tone="brandSoft" />
          <Bone className="h-11 w-full rounded-lg" tone="light" />
          <Bone className="h-11 w-full rounded-lg" tone="light" />
          <Bone className="h-11 w-full rounded-lg" tone="light" />
        </div>
        <div className="mt-auto space-y-1 border-t border-slate-200 p-3">
          <div className="flex items-center gap-3 px-3 py-2">
            <Bone className="h-9 w-9 shrink-0 rounded-full" />
            <div className="space-y-1.5">
              <Bone className="h-3.5 w-24" />
              <Bone className="h-3 w-28" tone="light" />
            </div>
          </div>
          <Bone className="h-11 w-full rounded-lg" tone="light" />
          <Bone className="h-11 w-full rounded-lg" tone="light" />
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-2 px-4 sm:px-6 lg:px-8">
            <Bone className="h-11 w-11 rounded-lg lg:hidden" tone="light" />
            <Bone
              className="ml-auto h-11 w-11 rounded-lg sm:ml-0 sm:w-full sm:max-w-sm"
              tone="light"
            />
          </div>
        </header>
        <main className="mx-auto flex w-full min-w-0 max-w-[1440px] flex-1 flex-col px-4 py-5 sm:px-6 lg:px-8">
          <DashboardSkeleton />
        </main>
        <AppFooter />
      </div>
    </div>
  );
}

export function PreparePageSkeleton() {
  return (
    <div className="page-stack min-h-0 flex-1" aria-hidden="true">
      <HeadingSkeleton back badge actions={['w-24', 'w-32', 'w-44']} />
      <div className="grid min-h-0 flex-1 grid-cols-1 items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="surface flex min-w-0 flex-col space-y-5 p-4">
          <Bone className="h-11 w-full rounded-lg" tone="light" />
          <Bone className="h-6 w-40" />
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <Bone className="h-11 w-full rounded-lg" tone="light" />
            <Bone className="h-11 w-full rounded-lg" tone="light" />
            <Bone className="h-11 w-full rounded-lg" tone="brand" />
          </div>
          <Bone className="h-16 w-full rounded-lg" tone="light" />
          <Bone className="h-16 w-full rounded-lg" tone="light" />
        </div>
        <ViewerSkeleton className="h-[80vh] max-h-230 sm:min-h-140" />
      </div>
    </div>
  );
}
