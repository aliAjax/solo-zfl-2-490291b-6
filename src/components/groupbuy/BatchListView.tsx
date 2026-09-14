import { Plus, Package, Users, Wallet, AlertTriangle, ChevronRight, RotateCcw } from 'lucide-react';
import { useGBStore } from '@/store/useGBStore';
import { batchSummary } from '@/groupbuy/engine';
import { StatusBadge, Money } from './ui';

export default function BatchListView() {
  const { data, selectBatch, openModal, resetDemo } = useGBStore();

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-xl font-bold text-gradient-brass">键帽团购 · 分期结算台</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            配色名额占位 · 候补补位 · 阶梯价 · 定金/尾款 · 退款与发货管控
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost text-xs" onClick={resetDemo} title="恢复示例数据">
            <RotateCcw className="h-3.5 w-3.5" /> 重置示例
          </button>
          <button className="btn-primary" onClick={() => openModal('createBatch')}>
            <Plus className="h-4 w-4" /> 新建批次
          </button>
        </div>
      </div>

      {data.batches.length === 0 ? (
        <div className="card-surface flex flex-col items-center justify-center px-6 py-20 text-center">
          <div className="keycap mb-4 h-14 w-14 min-w-[56px] rounded-xl text-xl opacity-60">
            <Package className="h-6 w-6" />
          </div>
          <h3 className="mb-2 font-mono text-base font-semibold text-ink-200">还没有团购批次</h3>
          <p className="mb-4 max-w-sm text-sm text-ink-500">新建一个批次，录入配色名额、阶梯单价、定金比例和尾款截止日。</p>
          <button className="btn-primary" onClick={() => openModal('createBatch')}>
            <Plus className="h-4 w-4" /> 新建批次
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.batches.map((b) => {
            const sum = batchSummary(data, b.id);
            return (
              <button
                key={b.id}
                onClick={() => selectBatch(b.id)}
                className="card-surface group p-5 text-left transition-all hover:-translate-y-0.5 hover:border-brass-300/40 hover:shadow-glow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-mono text-base font-bold text-ink-100 group-hover:text-brass-100">
                      {b.name}
                    </h3>
                    <p className="mt-0.5 line-clamp-1 text-xs text-ink-500">{b.note || '—'}</p>
                  </div>
                  <StatusBadge status={b.status} />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <MiniMetric
                    icon={<Users className="h-3.5 w-3.5" />}
                    value={`${sum.occupied}/${sum.quota}`}
                    label="名额占用"
                    tone={sum.free === 0 ? 'warn' : 'default'}
                  />
                  <MiniMetric
                    icon={<Wallet className="h-3.5 w-3.5" />}
                    value={<Money value={sum.received} />}
                    label="已收"
                    tone="good"
                  />
                  <MiniMetric
                    icon={<AlertTriangle className="h-3.5 w-3.5" />}
                    value={<Money value={sum.debt} />}
                    label="欠款"
                    tone={sum.debt > 0 ? 'bad' : 'default'}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {b.colors.map((c) => (
                      <span key={c.id} className="chip chip-inactive !py-0.5 !text-[10px]">
                        {c.name}
                      </span>
                    ))}
                    {sum.waitlist > 0 && (
                      <span className="chip border border-brass-300/40 bg-brass-300/10 !py-0.5 !text-[10px] text-brass-200">
                        候补 {sum.waitlist}
                      </span>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-600 transition-transform group-hover:translate-x-0.5 group-hover:text-brass-300" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniMetric({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
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
    <div className="rounded-lg border border-ink-700/60 bg-ink-900/50 px-2 py-2">
      <div className={`flex items-center justify-center gap-1 font-mono text-sm font-bold ${toneCls}`}>
        {icon}
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-ink-500">{label}</div>
    </div>
  );
}
