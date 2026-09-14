import { useMemo, useState } from 'react';
import { Wallet, Undo2 } from 'lucide-react';
import ModalShell from './ModalShell';
import { useGBStore } from '@/store/useGBStore';
import { signupSettlement } from '@/groupbuy/engine';
import { centsToYuan, yuanToCents } from '@/groupbuy/money';
import type { TxnKind } from '@/groupbuy/types';
import { Money } from './ui';

function useTarget() {
  const { ui, data } = useGBStore();
  return useMemo(() => {
    const su = data.signups.find((s) => s.id === ui.targetSignupId);
    const batch = su ? data.batches.find((b) => b.id === su.batchId) : undefined;
    const set = su ? signupSettlement(data, su.id) : null;
    return { su, batch, set };
  }, [ui.targetSignupId, data]);
}

function Row({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-ink-500">{label}</span>
      <Money value={value} className={tone ?? 'text-ink-200'} />
    </div>
  );
}

export function PaymentModal() {
  const { postPayment, closeModal } = useGBStore();
  const { su, batch, set } = useTarget();
  const [kind, setKind] = useState<Exclude<TxnKind, 'refund'>>('deposit');
  const [amountYuan, setAmountYuan] = useState('');
  const [txnNo, setTxnNo] = useState('');
  const [note, setNote] = useState('');

  if (!su || !batch || !set) return null;

  const depositRemaining = Math.max(set.depositDue - set.depositPaid, 0);
  const suggested = kind === 'deposit' ? depositRemaining : Math.max(set.due, 0);

  const submit = () => {
    const cents = yuanToCents(Number(amountYuan) || 0);
    postPayment(su.id, kind, cents, txnNo, note);
  };

  return (
    <ModalShell
      title="分期入账"
      subtitle={`${su.participant} · ${batch.colors.find((c) => c.id === su.colorId)?.name ?? ''} ×${su.qty}`}
      footer={
        <>
          <button className="btn-ghost" onClick={closeModal}>
            取消
          </button>
          <button data-testid="pay-confirm" className="btn-primary" onClick={submit} disabled={!txnNo.trim()}>
            <Wallet className="h-4 w-4" /> 确认入账
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5 rounded-lg border border-ink-700/70 bg-ink-900/60 p-3">
          <Row label="应收总额" value={set.receivable} />
          <Row label={`应收定金（${batch.depositRatioPct}%）`} value={set.depositDue} />
          <Row label="应收尾款" value={set.balanceDue} />
          <div className="divider my-1" />
          <Row label="已收" value={set.received} tone="text-moss-400" />
          <Row label="已退款" value={set.refunded} tone="text-wine-400" />
          <Row label="剩余欠款" value={set.due} tone={set.due > 0 ? 'text-brass-200' : 'text-ink-300'} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(['deposit', 'balance'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-lg border px-3 py-2 text-sm transition-all ${
                kind === k
                  ? 'border-brass-300/60 bg-brass-300/10 text-brass-200'
                  : 'border-ink-700/70 bg-ink-900/60 text-ink-400 hover:border-brass-300/30'
              }`}
            >
              {k === 'deposit' ? '定金' : '尾款'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-400">
              金额（元）
              <button
                type="button"
                className="text-[11px] text-brass-300 hover:underline"
                onClick={() => setAmountYuan(centsToYuan(suggested))}
              >
                填入建议 ¥{centsToYuan(suggested)}
              </button>
            </span>
            <input
              data-testid="pay-amount"
              type="number"
              step="0.01"
              min={0}
              className="input-field"
              value={amountYuan}
              onChange={(e) => setAmountYuan(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-400">
              交易号 <span className="text-wine-400">*</span>
            </span>
            <input
              data-testid="pay-txn"
              className="input-field font-mono"
              value={txnNo}
              onChange={(e) => setTxnNo(e.target.value)}
              placeholder="微信/支付宝/银行流水号"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-400">备注</span>
          <input className="input-field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="text-[11px] text-ink-500">
          同一交易号重复提交将被幂等忽略；入账金额不得超过应收，避免重复扣减。
        </p>
      </div>
    </ModalShell>
  );
}

export function RefundModal() {
  const { postRefund, closeModal } = useGBStore();
  const { su, batch, set } = useTarget();
  const [amountYuan, setAmountYuan] = useState('');
  const [txnNo, setTxnNo] = useState('');
  const [note, setNote] = useState('');

  if (!su || !batch || !set) return null;
  const refundable = set.received - set.refunded;

  const submit = () => {
    postRefund(su.id, yuanToCents(Number(amountYuan) || 0), txnNo, note);
  };

  return (
    <ModalShell
      title="退款"
      subtitle={`${su.participant} · 退款不能超过已收金额`}
      footer={
        <>
          <button className="btn-ghost" onClick={closeModal}>
            取消
          </button>
          <button data-testid="refund-confirm" className="btn-danger px-5" onClick={submit} disabled={!txnNo.trim() || refundable <= 0}>
            <Undo2 className="h-4 w-4" /> 确认退款
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5 rounded-lg border border-ink-700/70 bg-ink-900/60 p-3">
          <Row label="累计已收" value={set.received} tone="text-moss-400" />
          <Row label="累计已退" value={set.refunded} tone="text-wine-400" />
          <div className="divider my-1" />
          <Row label="最多可退（净已收）" value={refundable} tone="text-brass-200" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-400">
              退款金额（元）
              <button
                type="button"
                className="text-[11px] text-brass-300 hover:underline"
                onClick={() => setAmountYuan(centsToYuan(refundable))}
              >
                全额 ¥{centsToYuan(refundable)}
              </button>
            </span>
            <input
              data-testid="refund-amount"
              type="number"
              step="0.01"
              min={0}
              className="input-field"
              value={amountYuan}
              onChange={(e) => setAmountYuan(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-400">
              退款交易号 <span className="text-wine-400">*</span>
            </span>
            <input
              data-testid="refund-txn"
              className="input-field font-mono"
              value={txnNo}
              onChange={(e) => setTxnNo(e.target.value)}
              placeholder="退款流水号"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-400">备注</span>
          <input className="input-field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
    </ModalShell>
  );
}
