import { useMemo, useState } from 'react';
import { Plus, Trash2, Palette, Layers } from 'lucide-react';
import ModalShell from './ModalShell';
import { useGBStore } from '@/store/useGBStore';
import { yuanToCents } from '@/groupbuy/money';
import type { PriceTier } from '@/groupbuy/types';

interface ColorRow {
  id?: string;
  name: string;
  quota: string;
}
interface TierRow {
  upTo: string; // 数字 或 '' 表示开放档
  priceYuan: string;
}

function emptyColor(): ColorRow {
  return { name: '', quota: '' };
}

export default function BatchFormModal() {
  const { ui, data, createBatch, updateBatch, closeModal } = useGBStore();
  const editing = useMemo(
    () => (ui.modal === 'editBatch' ? data.batches.find((b) => b.id === ui.selectedBatchId) : null),
    [ui.modal, ui.selectedBatchId, data.batches],
  );

  const [name, setName] = useState(editing?.name ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [colors, setColors] = useState<ColorRow[]>(
    editing
      ? editing.colors.map((c) => ({ id: c.id, name: c.name, quota: String(c.quota) }))
      : [{ name: '', quota: '' }],
  );
  const [tiers, setTiers] = useState<TierRow[]>(
    editing
      ? [...editing.tiers]
          .sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity))
          .map((t) => ({ upTo: t.upTo === null ? '' : String(t.upTo), priceYuan: (t.priceCents / 100).toString() }))
      : [
          { upTo: '1', priceYuan: '' },
          { upTo: '', priceYuan: '' },
        ],
  );
  const [depositPct, setDepositPct] = useState(String(editing?.depositRatioPct ?? 30));
  const [deadline, setDeadline] = useState(editing?.balanceDeadline ?? '');
  const [shippingYuan, setShippingYuan] = useState(
    editing ? String(editing.shippingCents / 100) : '0',
  );

  const setColor = (i: number, patch: Partial<ColorRow>) =>
    setColors((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const setTier = (i: number, patch: Partial<TierRow>) =>
    setTiers((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  const submit = () => {
    const colorInput = colors
      .filter((c) => c.name.trim() !== '' || c.quota !== '')
      .map((c) => ({ name: c.name.trim(), quota: Math.floor(Number(c.quota)) }));
    const tierInput: PriceTier[] = tiers
      .filter((t) => t.priceYuan !== '')
      .map((t) => ({
        upTo: t.upTo === '' ? null : Math.floor(Number(t.upTo)),
        priceCents: yuanToCents(Number(t.priceYuan)),
      }))
      .sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));

    if (editing) {
      const colorOptions = colors
        .filter((c) => c.name.trim() !== '' && c.quota !== '')
        .map((c, i) => ({
          id: c.id ?? `new-${i}-${c.name}`,
          name: c.name.trim(),
          quota: Math.floor(Number(c.quota)),
        }));
      updateBatch(editing.id, {
        name,
        note,
        colors: colorOptions,
        tiers: tierInput,
        depositRatioPct: Math.floor(Number(depositPct)),
        balanceDeadline: deadline,
        shippingCents: yuanToCents(Number(shippingYuan) || 0),
      });
    } else {
      createBatch({
        name,
        note,
        colors: colorInput,
        tiers: tierInput,
        depositRatioPct: Math.floor(Number(depositPct)),
        balanceDeadline: deadline,
        shippingCents: yuanToCents(Number(shippingYuan) || 0),
      });
    }
  };

  return (
    <ModalShell
      title={editing ? '编辑批次' : '新建键帽团购批次'}
      subtitle="录入配色名额、阶梯单价、定金比例、尾款截止日与运费"
      footer={
        <>
          <button className="btn-ghost" onClick={closeModal}>
            取消
          </button>
          <button data-testid="batch-submit" className="btn-primary" onClick={submit}>
            {editing ? '保存修改' : '创建批次'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="批次名称" required>
            <input
              data-testid="batch-name"
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：GMK 暖铜 键帽团购"
            />
          </Field>
          <Field label="尾款截止日" required>
            <input
              data-testid="batch-deadline"
              type="date"
              className="input-field"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </Field>
        </div>
        <Field label="备注">
          <input
            className="input-field"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="材质、高度、工艺等说明"
          />
        </Field>

        {/* 配色名额 */}
        <div>
          <GroupLabel icon={<Palette className="h-3.5 w-3.5" />} text="配色与名额" />
          <div className="space-y-2">
            {colors.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  data-testid={`batch-color-name-${i}`}
                  className="input-field flex-1"
                  value={c.name}
                  onChange={(e) => setColor(i, { name: e.target.value })}
                  placeholder={`配色 ${i + 1} 名称`}
                />
                <input
                  data-testid={`batch-color-quota-${i}`}
                  className="input-field w-28"
                  type="number"
                  min={1}
                  value={c.quota}
                  onChange={(e) => setColor(i, { quota: e.target.value })}
                  placeholder="名额"
                />
                <button
                  className="btn-ghost px-2.5 py-2.5 text-wine-400"
                  onClick={() => setColors((cs) => cs.filter((_, idx) => idx !== i))}
                  title="删除配色"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            className="btn-ghost mt-2 text-xs"
            onClick={() => setColors((cs) => [...cs, emptyColor()])}
          >
            <Plus className="h-3.5 w-3.5" /> 添加配色
          </button>
        </div>

        {/* 阶梯单价 */}
        <div>
          <GroupLabel
            icon={<Layers className="h-3.5 w-3.5" />}
            text="阶梯单价（数量 ≤ 上限命中本档；上限留空 = 开放档）"
          />
          <div className="space-y-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-ink-500 whitespace-nowrap">数量 ≤</span>
                <input
                  data-testid={`batch-tier-upto-${i}`}
                  className="input-field w-28"
                  type="number"
                  min={1}
                  value={t.upTo}
                  onChange={(e) => setTier(i, { upTo: e.target.value })}
                  placeholder="开放"
                />
                <span className="text-xs text-ink-500 whitespace-nowrap">单价 ¥</span>
                <input
                  data-testid={`batch-tier-price-${i}`}
                  className="input-field w-32"
                  type="number"
                  step="0.01"
                  min={0}
                  value={t.priceYuan}
                  onChange={(e) => setTier(i, { priceYuan: e.target.value })}
                  placeholder="0.00"
                />
                <button
                  className="btn-ghost px-2.5 py-2.5 text-wine-400"
                  onClick={() => setTiers((ts) => ts.filter((_, idx) => idx !== i))}
                  title="删除档位"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            className="btn-ghost mt-2 text-xs"
            onClick={() => setTiers((ts) => [...ts, { upTo: '', priceYuan: '' }])}
          >
            <Plus className="h-3.5 w-3.5" /> 添加档位
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={`定金比例：${depositPct || 0}%`}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={depositPct || 0}
              onChange={(e) => setDepositPct(e.target.value)}
            />
          </Field>
          <Field label="每单运费（元）">
            <input
              className="input-field"
              type="number"
              step="0.01"
              min={0}
              value={shippingYuan}
              onChange={(e) => setShippingYuan(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-400">
        {label}
        {required && <span className="ml-0.5 text-wine-400">*</span>}
      </span>
      {children}
    </label>
  );
}

function GroupLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brass-200">
      {icon}
      {text}
    </div>
  );
}
