import { useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import ModalShell from './ModalShell';
import { useGBStore } from '@/store/useGBStore';
import { colorOccupied } from '@/groupbuy/engine';
import { unitPriceCents, receivableCents, depositDueCents } from '@/groupbuy/money';
import { centsToYuan } from '@/groupbuy/money';

export default function SignupModal() {
  const { ui, data, signup, closeModal } = useGBStore();
  const batch = useMemo(
    () => data.batches.find((b) => b.id === ui.selectedBatchId),
    [data.batches, ui.selectedBatchId],
  );

  const [participant, setParticipant] = useState('');
  const [contact, setContact] = useState('');
  const [colorId, setColorId] = useState(batch?.colors[0]?.id ?? '');
  const [qty, setQty] = useState(1);

  if (!batch) return null;

  const occupied = colorId ? colorOccupied(data, batch.id, colorId) : 0;
  const color = batch.colors.find((c) => c.id === colorId);
  const free = color ? color.quota - occupied : 0;
  const willWaitlist = color ? qty > free : false;
  const unit = unitPriceCents(batch, qty);
  const receivable = receivableCents(batch, qty);
  const deposit = depositDueCents(batch, qty);

  const submit = () => {
    signup(batch.id, { participant, contact, colorId, qty });
  };

  return (
    <ModalShell
      title="报名占位"
      subtitle={`${batch.name} · 报名按配色占位，超额自动进入候补`}
      footer={
        <>
          <button className="btn-ghost" onClick={closeModal}>
            取消
          </button>
          <button data-testid="signup-confirm" className="btn-primary" onClick={submit} disabled={!participant.trim()}>
            <UserPlus className="h-4 w-4" />
            {willWaitlist ? '加入候补' : '确认占位'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-400">
              参与者 <span className="text-wine-400">*</span>
            </span>
            <input
              data-testid="signup-name"
              className="input-field"
              value={participant}
              onChange={(e) => setParticipant(e.target.value)}
              placeholder="昵称 / 姓名"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-400">联系方式</span>
            <input
              className="input-field"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="微信 / 手机（选填）"
            />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-ink-400">选择配色</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {batch.colors.map((c) => {
              const used = colorOccupied(data, batch.id, c.id);
              const full = used >= c.quota;
              const active = colorId === c.id;
              return (
                <button
                  key={c.id}
                  data-testid={`signup-color-${c.name}`}
                  onClick={() => setColorId(c.id)}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                    active
                      ? 'border-brass-300/60 bg-brass-300/10'
                      : 'border-ink-700/70 bg-ink-900/60 hover:border-brass-300/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-ink-100">{c.name}</span>
                    {full && <span className="text-[10px] text-wine-400">已满</span>}
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-ink-500">
                    名额 {used}/{c.quota} · 余 {Math.max(c.quota - used, 0)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-400">数量</span>
            <input
              data-testid="signup-qty"
              type="number"
              min={1}
              className="input-field"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </label>
          <div className="rounded-lg border border-ink-700/70 bg-ink-900/60 px-3 py-2 text-xs font-mono text-ink-400 space-y-1">
            <div className="flex justify-between">
              <span>阶梯单价</span>
              <span className="text-ink-200">¥{centsToYuan(unit)}</span>
            </div>
            <div className="flex justify-between">
              <span>应收（含运费 ¥{centsToYuan(batch.shippingCents)}）</span>
              <span className="text-brass-200">¥{centsToYuan(receivable)}</span>
            </div>
            <div className="flex justify-between">
              <span>定金 {batch.depositRatioPct}%</span>
              <span className="text-moss-400">¥{centsToYuan(deposit)}</span>
            </div>
          </div>
        </div>

        {willWaitlist && (
          <div className="rounded-lg border border-brass-300/40 bg-brass-300/10 px-3 py-2.5 text-xs text-brass-200">
            该配色仅剩 {free} 个名额，本次报名 {qty} 件将进入候补；有名额释放时按候补顺序自动补位。
          </div>
        )}
      </div>
    </ModalShell>
  );
}
