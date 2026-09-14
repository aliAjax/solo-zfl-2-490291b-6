import { centsToYuan } from '@/groupbuy/money';
import type { BatchStatus } from '@/groupbuy/types';
import { STATUS_LABELS } from '@/groupbuy/types';
import { cn } from '@/lib/utils';

/** 金额：分 -> ¥123.00 */
export function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('font-mono tabular-nums', className)}>
      <span className="opacity-60">¥</span>
      {centsToYuan(value)}
    </span>
  );
}

const STATUS_STYLES: Record<BatchStatus, string> = {
  recruiting: 'bg-moss-500/15 text-moss-400 border-moss-500/35',
  locked: 'bg-slateblue-500/15 text-slateblue-400 border-slateblue-500/35',
  production: 'bg-brass-300/15 text-brass-200 border-brass-300/35',
  shipping: 'bg-[#5a4a8e]/15 text-[#a894d4] border-[#5a4a8e]/40',
  completed: 'bg-ink-600/30 text-ink-300 border-ink-600/50',
  cancelled: 'bg-wine-500/15 text-wine-400 border-wine-500/35',
};

const STATUS_DOT: Record<BatchStatus, string> = {
  recruiting: 'bg-moss-400',
  locked: 'bg-slateblue-400',
  production: 'bg-brass-300',
  shipping: 'bg-[#a894d4]',
  completed: 'bg-ink-400',
  cancelled: 'bg-wine-400',
};

export function StatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={cn('chip border text-[11px]', STATUS_STYLES[status])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function StatTile({
  label,
  children,
  tone = 'default',
  hint,
}: {
  label: string;
  children: React.ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  hint?: string;
}) {
  const toneCls =
    tone === 'good'
      ? 'text-moss-400'
      : tone === 'warn'
        ? 'text-brass-200'
        : tone === 'bad'
          ? 'text-wine-400'
          : 'text-ink-100';
  return (
    <div className="card-surface px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500">
        {label}
      </div>
      <div className={cn('mt-1 font-mono text-xl font-bold tabular-nums', toneCls)}>
        {children}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div>}
    </div>
  );
}
