/** Shown while the sender is hosting this signing on their own device (docs/22, ADR 0033). */
export function InPersonBanner({ hostName }: { hostName: string }) {
  return (
    <p role="note" className="bg-slate-800 px-4 py-2 text-center text-xs font-medium text-white">
      Signing in person, on {hostName}’s device
    </p>
  );
}
