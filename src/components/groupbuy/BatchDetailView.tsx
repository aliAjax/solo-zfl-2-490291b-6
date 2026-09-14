import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Plus,
  Pencil,
  Users,
  Wallet,
  PiggyBank,
  AlertTriangle,
  Undo2,
  Lock,
  Factory,
  Truck,
  CheckCircle2,
  Ban,
  CalendarClock,
  PackageCheck,
} from 'lucide-react';
import { useGBStore } from '@/store/useGBStore';
import {
  batchSummary,
  colorOccupied,
  waitlistQueue,
  signupSettlement,
} from '@/groupbuy/engine';
import type { BatchStatus } from '@/groupbuy/types';
import { STATUS_LABELS, STATUS_ORDER } from '@/groupbuy/types';
import { StatusBadge, StatTile, Money } from './ui';
import SignupRow from './SignupRow';
import BatchFormModal from './BatchFormModal';
import SignupModal from './SignupModal';
import { PaymentModal, RefundModal } from './PaymentModals';

export default function BatchDetailView({ batchId }: { batchId: string }) {
  const { data, selectBatch, openModal, transition } = useGBStore();
  const batch = data.batches.find((b) => b.id === batchId);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const signups = useMemo(
    () => data.signups.filter((s) => s.batchId === batchId),
    [data.signups, batchId],
  );

  if (!batch) {
    return (
      <div className="card-surface p-10 text-center text-sm text-ink-500">
        批次不存在或已被移除。
        <div className="mt-3">
          <button className="btn-ghost text-xs" onClick={() => selectBatch(null)}>
            <ArrowLeft className="h-3.5 w-3.5" /> 返回列表
          </button>
        </div>
      </div>
    );
  }

  const sum = batchSummary(data, batchId);
  const active = signups
    .filter((s) => s.status === 'active')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const waiting = waitlistQueue(data, batchId);
  const cancelled = signups.filter((s) => s.status === 'cancelled');
  const recruiting = batch.status === 'recruiting';

  const nextStep: Record<BatchStatus, { target: BatchStatus; label: string; icon: React.ReactNode } | null> = {
    recruiting: { target: 'locked', label: '锁单', icon: <Lock className="h-4 w-4" /> },
    locked: { target: 'production', label: '开始生产', icon: <Factory className="h-4 w-4" /> },
    production: { target: 'shipping', label: '进入发货', icon: <Truck className="h-4 w-4" /> },
    shipping: { target: 'completed', label: '完成团购', icon: <CheckCircle2 className="h-4 w-4" /> },
    completed: null,
    cancelled: null,
  };
  const step = nextStep[batch.status];
  const canCancel = ['recruiting', 'locked', 'production'].includes(batch.status);

  const unpaidCount = active.filter((s) => signupSettlement(data, s.id).due > 0).length;
  const unshippedCount = active.filter((s) => !s.shippedAt).length;

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* 顶栏 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button className="btn-ghost mt-0.5 px-2.5 py-2" data-testid="back-to-list" onClick={() => selectBatch(null)} title="返回列表">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-xl font-bold text-gradient-brass">{batch.name}</h2>
              <StatusBadge status={batch.status} />
            </div>
            <p className="mt-0.5 text-xs text-ink-500">
              {batch.note || '—'}
              <span className="mx-1.5 text-ink-700">·</span>
              <CalendarClock className="mr-1 inline h-3 w-3" />
              尾款截止 {batch.balanceDeadline}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {recruiting && (
            <button className="btn-ghost text-xs" data-testid="edit-batch" onClick={() => openModal('editBatch')}>
              <Pencil className="h-3.5 w-3.5" /> 编辑批次
            </button>
          )}
          {recruiting && (
            <button className="btn-primary text-sm" data-testid="signup-open" onClick={() => openModal('signup')}>
              <Plus className="h-4 w-4" /> 报名占位
            </button>
          )}
        </div>
      </div>

      {/* 状态流 */}
      <div className="card-surface flex flex-wrap items-center gap-2 p-4">
        {STATUS_ORDER.map((st, i) => {
          const curIdx = STATUS_ORDER.indexOf(batch.status);
          const reached = batch.status === 'cancelled' ? false : i <= curIdx;
          const isCurrent = st === batch.status;
          return (
            <div key={st} className="flex items-center gap-2">
              <span
                className={`chip border text-[11px] ${
                  isCurrent
                    ? 'border-brass-300/60 bg-brass-300/15 text-brass-100'
                    : reached
                      ? 'border-moss-500/40 bg-moss-500/10 text-moss-400'
                      : 'border-ink-700 bg-ink-900/40 text-ink-600'
                }`}
              >
                {STATUS_LABELS[st]}
              </span>
              {i < STATUS_ORDER.length - 1 && <span className="text-ink-700">→</span>}
            </div>
          );
        })}
        {batch.status === 'cancelled' && (
          <span className="chip border border-wine-500/40 bg-wine-500/10 text-[11px] text-wine-400">
            已取消
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {step && (
            <button
              data-testid={`transition-${step.target}`}
              className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => transition(batch.id, step.target)}
              disabled={
                (step.target === 'shipping' && unpaidCount > 0) ||
                (step.target === 'completed' && unshippedCount > 0)
              }
              title={
                step.target === 'shipping' && unpaidCount > 0
                  ? `仍有 ${unpaidCount} 笔欠款未结清`
                  : step.target === 'completed' && unshippedCount > 0
                    ? `仍有 ${unshippedCount} 笔正式订单未发货`
                    : undefined
              }
            >
              {step.icon}
              {step.label}
            </button>
          )}
          {canCancel && (
            confirmCancel ? (
              <span className="flex items-center gap-1.5">
                <button
                  data-testid="cancel-batch-confirm"
                  className="btn-danger text-xs"
                  onClick={() => {
                    transition(batch.id, 'cancelled');
                    setConfirmCancel(false);
                  }}
                >
                  <Ban className="h-3.5 w-3.5" /> 确认取消
                </button>
                <button className="btn-ghost px-2.5 text-xs" data-testid="cancel-batch-abort" onClick={() => setConfirmCancel(false)}>
                  再想想
                </button>
              </span>
            ) : (
              <button className="btn-ghost text-xs text-wine-400" data-testid="cancel-batch-start" onClick={() => setConfirmCancel(true)}>
                <Ban className="h-3.5 w-3.5" /> 取消批次
              </button>
            )
          )}
        </div>
      </div>

      {/* 看板：名额 / 应收 / 已收 / 欠款 / 退款 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="名额占用"
          tone={sum.free === 0 ? 'warn' : 'default'}
          hint={`候补 ${sum.waitlist} 人 · 共 ${sum.activeCount} 单`}
        >
          <span className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            {sum.occupied}/{sum.quota}
          </span>
        </StatTile>
        <StatTile label="应收" hint={`运费 ¥${(batch.shippingCents / 100).toFixed(2)}/单`}>
          <span className="flex items-center gap-1">
            <PiggyBank className="h-4 w-4" />
            <Money value={sum.receivable} />
          </span>
        </StatTile>
        <StatTile label="已收" tone="good" hint={`已结清 ${sum.settledCount} 单`}>
          <span className="flex items-center gap-1">
            <Wallet className="h-4 w-4" />
            <Money value={sum.received} />
          </span>
        </StatTile>
        <StatTile label="欠款" tone={sum.debt > 0 ? 'bad' : 'default'} hint={sum.debt > 0 ? `${unpaidCount} 单未结清，不能发货` : '无欠款'}>
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            <Money value={sum.debt} />
          </span>
        </StatTile>
        <StatTile label="退款" tone={sum.refunded > 0 ? 'warn' : 'default'} hint="累计已退">
          <span className="flex items-center gap-1">
            <Undo2 className="h-4 w-4" />
            <Money value={sum.refunded} />
          </span>
        </StatTile>
      </div>

      {/* 配色名额条 */}
      <div className="card-surface p-4">
        <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brass-200">
          <Users className="h-3.5 w-3.5" /> 配色名额
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {batch.colors.map((c) => {
            const used = colorOccupied(data, batch.id, c.id);
            const pct = Math.min((used / c.quota) * 100, 100);
            const full = used >= c.quota;
            const wl = waiting.filter((w) => w.colorId === c.id).length;
            return (
              <div key={c.id} className="rounded-lg border border-ink-700/60 bg-ink-900/50 p-3">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-ink-200">{c.name}</span>
                  <span className={`font-mono ${full ? 'text-wine-400' : 'text-moss-400'}`}>
                    {used}/{c.quota}
                  </span>
                </div>
                <div className="rating-bar-track h-2">
                  <div
                    className="rating-bar-fill"
                    style={{
                      width: `${pct}%`,
                      background: full
                        ? 'linear-gradient(90deg,#853a3a,#c27575)'
                        : 'linear-gradient(90deg,#c07a2a,#e9c989)',
                    }}
                  />
                </div>
                <div className="mt-1 text-[10px] text-ink-500">
                  {full ? '已满' : `余 ${c.quota - used}`}
                  {wl > 0 && <span className="text-brass-200"> · 候补 {wl} 人</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 报名列表 */}
      <div className="space-y-3">
        <SectionTitle count={active.length} title="正式占位" />
        {active.length === 0 ? (
          <Empty text={recruiting ? '还没有人占位，点击「报名占位」开始。' : '暂无正式占位。'} />
        ) : (
          <div className="space-y-2">
            {active.map((su) => (
              <SignupRow key={su.id} su={su} batch={batch} />
            ))}
          </div>
        )}

        {waiting.length > 0 && (
          <>
            <SectionTitle count={waiting.length} title="候补队列（释放名额时按顺序补位，最后一席不重复）" />
            <div className="space-y-2">
              {waiting.map((su) => (
                <SignupRow key={su.id} su={su} batch={batch} />
              ))}
            </div>
          </>
        )}

        {cancelled.length > 0 && (
          <>
            <SectionTitle count={cancelled.length} title="已取消" />
            <div className="space-y-2">
              {cancelled.map((su) => (
                <SignupRow key={su.id} su={su} batch={batch} />
              ))}
            </div>
          </>
        )}
      </div>

      {sum.shippedCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-[#a894d4]">
          <PackageCheck className="h-4 w-4" /> 已发货 {sum.shippedCount} 单
        </div>
      )}
    </div>
  );
}

export function GBModals() {
  const modal = useGBStore((s) => s.ui.modal);
  return (
    <>
      {(modal === 'createBatch' || modal === 'editBatch') && <BatchFormModal />}
      {modal === 'signup' && <SignupModal />}
      {modal === 'payment' && <PaymentModal />}
      {modal === 'refund' && <RefundModal />}
    </>
  );
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 pt-1 text-xs font-semibold uppercase tracking-wider text-ink-400">
      {title}
      <span className="rounded-full bg-ink-700/60 px-1.5 font-mono text-[10px] text-ink-300">{count}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="card-surface p-6 text-center text-xs text-ink-500">{text}</div>;
}
