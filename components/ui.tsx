import type { ReactNode } from "react";
import { formatCompact, formatNumber, postTypeLabel } from "@/lib/format";

/** Hover/focus tooltip. Keyboard-reachable so it also works without a mouse. */
export function InfoTip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex" tabIndex={0} aria-label={text}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-[14rem] -translate-x-1/2 rounded-md bg-zinc-900 px-2 py-1 text-center text-xs font-normal text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {text}
      </span>
    </span>
  );
}

export function NullDash({ reason }: { reason: string }) {
  return (
    <InfoTip text={reason}>
      <span className="cursor-help text-zinc-400 underline decoration-dotted underline-offset-4 dark:text-zinc-500">
        —
      </span>
    </InfoTip>
  );
}

/** A table cell value: full number (1,234) or a dash with the reason. */
export function NumberCell({ value, reason }: { value: number | null; reason: string }) {
  return value === null ? <NullDash reason={reason} /> : <span className="tabular-nums">{formatNumber(value)}</span>;
}

/** Compact number (1.2K) with the exact value on hover. */
export function CompactNumber({ value }: { value: number }) {
  return (
    <span className="tabular-nums" title={formatNumber(value)}>
      {formatCompact(value)}
    </span>
  );
}

export function TypeBadge({ mediaType, productType }: { mediaType: number | null; productType: string | null }) {
  const label = postTypeLabel(mediaType, productType);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      {productType === "ad" && (
        <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          Ad
        </span>
      )}
    </span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-10 text-sm text-zinc-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-700 dark:border-t-zinc-200" />
      {label}
    </div>
  );
}

export function ErrorState({ title, message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
    >
      <p className="font-medium">{title ?? "Something went wrong"}</p>
      <p className="mt-1">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 font-medium underline underline-offset-4">
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{children}</div>}
    </div>
  );
}
