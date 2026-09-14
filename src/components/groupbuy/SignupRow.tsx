import { useMemo, useState } from 'react';
import { Wallet, Undo2, Truck, XCircle, MapPin, Pencil, ChevronDown } from 'lucide-react';
import type { Signup, GroupBatch } from '@/groupbuy/types';
import { signupSettlement, colorOccupied } from '@/groupbuy/engine';
import { useGBStore } from '@/store/useGBStore';
import { centsToYuan } from '@/groupbuy/money';
import { Money } from './ui';

export default function SignupRow({ su, batch }: { su: Signup; batch: GroupBatch }) {
  const { data, openModal, cancelSignup, changeColor, changeQty, updateAddress, markShipped } =
    useGBStore();
  const [open, setOpen] = useState(false);
  const [editColor, setEditColor] = useState(false);
  const [editQty, setEditQty] = useState(false);
  const [editAddr, setEditAddr] = useState(false);
  const [qtyDraft, setQtyDraft] = useState(String(su.qty));
  const [addrDraft, setAddrDraft] = useState(su.address);
  const [tracking, setTracking] = useState('');
  const [showShip, setShowShip] = useState(false);

  const set = signupSettlement(data, su.id);
  const color = batch.colors.find((c) => c.id === su.colorId);
  const cancelled = su.status === 'cancelled';
  const waitlisted = su.status === 'waitlisted';
  const recruiting = batch.status === 'recruiting';
  const shippingPhase = batch.status === 'shipping';
  const refundable = set.received - set.refunded;

  return (
    <div
      className={`rounded-lg border transition-colors ${
        cancelled
          ? 'border-ink-700/40 bg-ink-900/30 opacity-60'
          : waitlisted
            ? 'border-brass-300/25 bg-brass-300/[0.04]'
            : 'border-ink-700/60 bg-ink-900/50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-3">
        <button
          data-testid={`row-toggle-${su.id}`}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-[160px] flex-1 items-center gap-2 text-left"
        >
          <ChevronDown className={`h-4 w-4 text-ink-500 transition-transform ${open ? '' : '-rotate-90'}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink-100">{su.participant}</span>
              {waitlisted && (
                <span className="rounded-full border border-brass-300/40 bg-brass-300/10 px-1.5 py-px text-[10px] text-brass-200">
                  候补 #{su.waitlistSeq}
                </span>
              )}
              {cancelled && (
                <span className="rounded-full border border-ink-600 bg-ink-700/40 px-1.5 py-px text-[10px] text-ink-400">
                  已取消
                </span>
              )}
              {su.shippedAt && (
                <span className="rounded-full border border-[#5a4a8e]/50 bg-[#5a4a8e]/15 px-1.5 py-px text-[10px] text-[#a894d4]">
                  已发货
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              {color?.name ?? '—'} ×{su.qty}
              {su.contact ? ` · ${su.contact}` : ''}
            </div>
          </div>
        </button>

        {/* 金额条 */}
        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="text-ink-500">应收 <Money value={set.receivable} className="text-ink-300" /></span>
          <span className="text-ink-500">已收 <Money value={set.received} className="text-moss-400" /></span>
          <span className="text-ink-500">欠 <Money value={set.due} className={set.due > 0 ? 'text-wine-400' : 'text-ink-400'} /></span>
          {set.refunded > 0 && (
            <span className="text-ink-500">退 <Money value={set.refunded} className="text-brass-200" /></span>
          )}
        </div>

        {!cancelled && (
          <div className="flex items-center gap-1.5">
            {!waitlisted && (
              <>
                <IconBtn testid={`pay-${su.id}`} title="入账（定金/尾款）" onClick={() => openModal('payment', su.id)} disabled={batch.status === 'cancelled'}>
                  <Wallet className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn testid={`refund-${su.id}`} title="退款" onClick={() => openModal('refund', su.id)} disabled={refundable <= 0}>
                  <Undo2 className="h-3.5 w-3.5" />
                </IconBtn>
                {shippingPhase && !su.shippedAt && (
                  <IconBtn testid={`ship-${su.id}`} title="发货" tone="good" onClick={() => setShowShip((v) => !v)} disabled={set.due > 0}>
                    <Truck className="h-3.5 w-3.5" />
                  </IconBtn>
                )}
              </>
            )}
            <IconBtn testid={`cancel-${su.id}`} title="取消报名（释放名额触发候补补位）" tone="bad" onClick={() => cancelSignup(su.id)}>
              <XCircle className="h-3.5 w-3.5" />
            </IconBtn>
          </div>
        )}
      </div>

      {/* 发货条 */}
      {showShip && !cancelled && (
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-700/50 px-3.5 py-2.5">
          <span className="text-xs text-ink-400">物流单号</span>
          <input
            data-testid={`tracking-${su.id}`}
            className="input-field h-9 flex-1 py-1.5 text-xs"
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            placeholder="快递单号（选填）"
          />
          <button
            data-testid={`ship-confirm-${su.id}`}
            className="btn-primary px-3 py-1.5 text-xs"
            onClick={() => {
              if (markShipped(su.id, tracking)) setShowShip(false);
            }}
          >
            <Truck className="h-3.5 w-3.5" /> 确认发货
          </button>
          {set.due > 0 && <span className="text-[11px] text-wine-400">存在欠款，不能发货</span>}
        </div>
      )}

      {/* 展开详情 */}
      {open && (
        <div className="space-y-3 border-t border-ink-700/50 px-3.5 py-3">
          {/* 分期进度 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ProgressBox label={`定金 ${batch.depositRatioPct}%`} paid={set.depositPaid} due={set.depositDue} />
            <ProgressBox label="尾款" paid={set.balancePaid} due={set.balanceDue} />
            <ProgressBox label="已退款" paid={set.refunded} due={set.received} bad />
            <ProgressBox label="净付/应收" paid={set.netPaid} due={set.receivable} good={set.settled} />
          </div>

          {/* 配色 / 数量编辑（仅招募中占位报名） */}
          {recruiting && su.status === 'active' && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-ink-500">配色</span>
                {editColor ? (
                  <select
                    data-testid={`color-select-${su.id}`}
                    className="input-field h-9 w-auto py-1.5 text-xs"
                    defaultValue={su.colorId}
                    onChange={(e) => {
                      if (changeColor(su.id, e.target.value)) setEditColor(false);
                    }}
                  >
                    {batch.colors.map((c) => {
                      const free = c.quota - colorOccupied(data, batch.id, c.id) + (c.id === su.colorId ? su.qty : 0);
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name}（余 {free}）
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <button
                    data-testid={`color-chip-${su.id}`}
                    className={CHIP_INTERNAL}
                    onClick={() => setEditColor(true)}
                  >
                    {color?.name} <Pencil className="h-3 w-3" />
                  </button>
                )}
                <span className="text-[10px] text-ink-600">锁单后不可改</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-ink-500">数量</span>
                {editQty ? (
                  <span className="flex items-center gap-1">
                    <input
                      data-testid={`qty-input-${su.id}`}
                      type="number"
                      min={1}
                      className="input-field h-9 w-20 py-1.5 text-xs"
                      value={qtyDraft}
                      onChange={(e) => setQtyDraft(e.target.value)}
                    />
                    <button
                      data-testid={`qty-save-${su.id}`}
                      className="btn-primary px-2.5 py-1.5 text-xs"
                      onClick={() => {
                        if (changeQty(su.id, Math.floor(Number(qtyDraft) || 1))) setEditQty(false);
                      }}
                    >
                      保存
                    </button>
                  </span>
                ) : (
                  <button
                    data-testid={`qty-chip-${su.id}`}
                    className={CHIP_INTERNAL}
                    onClick={() => { setQtyDraft(String(su.qty)); setEditQty(true); }}
                  >
                    {su.qty} <Pencil className="h-3 w-3" />
                  </button>
                )}
                <span className="text-[10px] text-ink-600">跨档只调未结算尾款</span>
              </div>
            </div>
          )}

          {/* 地址：发货后不可改 */}
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs text-ink-500">
              <MapPin className="h-3.5 w-3.5" /> 收货地址
              {su.shippedAt && <span className="text-wine-400">· 已发货，不可修改</span>}
            </div>
            {editAddr && !su.shippedAt ? (
              <div className="flex items-center gap-2">
                <input
                  className="input-field h-9 py-1.5 text-xs"
                  value={addrDraft}
                  onChange={(e) => setAddrDraft(e.target.value)}
                  placeholder="收件地址"
                />
                <button
                  className="btn-primary px-3 py-1.5 text-xs"
                  onClick={() => {
                    if (updateAddress(su.id, addrDraft)) setEditAddr(false);
                  }}
                >
                  保存
                </button>
              </div>
            ) : (
              <button
                className={`text-xs ${su.shippedAt ? 'text-ink-500' : 'text-ink-300 hover:text-brass-200'}`}
                onClick={() => {
                  if (!su.shippedAt) {
                    setAddrDraft(su.address);
                    setEditAddr(true);
                  }
                }}
                disabled={!!su.shippedAt}
              >
                {su.address || '未填写地址'} {!su.shippedAt && <Pencil className="ml-1 inline h-3 w-3" />}
              </button>
            )}
            {su.shippedAt && su.trackingNo && (
              <div className="mt-1 font-mono text-[11px] text-[#a894d4]">单号：{su.trackingNo}</div>
            )}
          </div>

          {/* 流水 */}
          <LedgerList signupId={su.id} />
        </div>
      )}
    </div>
  );
}

const CHIP_INTERNAL =
  'chip border border-ink-600 bg-ink-800 text-ink-200 hover:border-brass-300/40';

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  tone,
  testid,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'good' | 'bad';
  testid?: string;
}) {
  const toneCls =
    tone === 'good'
      ? 'hover:border-moss-500/50 hover:text-moss-400'
      : tone === 'bad'
        ? 'hover:border-wine-500/50 hover:text-wine-400'
        : 'hover:border-brass-300/40 hover:text-brass-200';
  return (
    <button
      title={title}
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-ink-700/60 bg-ink-800/50 text-ink-400 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${toneCls}`}
    >
      {children}
    </button>
  );
}

function ProgressBox({
  label,
  paid,
  due,
  good,
  bad,
}: {
  label: string;
  paid: number;
  due: number;
  good?: boolean;
  bad?: boolean;
}) {
  const pct = due > 0 ? Math.min((Math.max(paid, 0) / due) * 100, 100) : 0;
  return (
    <div className="rounded-md border border-ink-700/50 bg-ink-950/40 p-2">
      <div className="flex items-center justify-between text-[10px] text-ink-500">
        <span>{label}</span>
        <span className="font-mono">
          ¥{centsToYuan(Math.max(paid, 0))}/¥{centsToYuan(due)}
        </span>
      </div>
      <div className="rating-bar-track mt-1.5 h-1.5">
        <div
          className="rating-bar-fill"
          style={{
            width: `${pct}%`,
            background: bad
              ? 'linear-gradient(90deg,#853a3a,#c27575)'
              : good
                ? 'linear-gradient(90deg,#4f6e41,#8bb078)'
                : 'linear-gradient(90deg,#c07a2a,#e9c989)',
          }}
        />
      </div>
    </div>
  );
}

function LedgerList({ signupId }: { signupId: string }) {
  const ledger = useGBStore((s) => s.data.ledger);
  const entries = useMemo(
    () => ledger.filter((e) => e.signupId === signupId),
    [ledger, signupId],
  );
  if (entries.length === 0)
    return <div className="text-[11px] text-ink-600">暂无交易流水</div>;
  const kindLabel = { deposit: '定金', balance: '尾款', refund: '退款' } as const;
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-ink-600">交易流水（按交易号幂等）</div>
      {entries.map((e) => (
        <div
          key={e.id}
          className="flex items-center justify-between rounded bg-ink-950/40 px-2 py-1 font-mono text-[11px]"
        >
          <span className={e.kind === 'refund' ? 'text-wine-400' : 'text-moss-400'}>
            {kindLabel[e.kind]} {e.kind === 'refund' ? '-' : '+'}¥{centsToYuan(e.amountCents)}
          </span>
          <span className="text-ink-500">{e.txnNo}</span>
        </div>
      ))}
    </div>
  );
}
