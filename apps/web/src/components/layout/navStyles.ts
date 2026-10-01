/** One look for every sidebar row, so a link, a button and the account block line up. */
export function navItemClass(active = false): string {
  return `flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors disabled:opacity-50 ${
    active
      ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200/70'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;
}
