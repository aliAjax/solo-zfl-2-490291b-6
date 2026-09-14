import type { GBState } from './types';
import {
  createBatch,
  signup,
  postPayment,
  transition,
  competeForLastSeat,
} from './engine';
import { yuanToCents } from './money';

const T0 = '2026-09-01T08:00:00.000Z';
const T1 = '2026-09-03T08:00:00.000Z';
const T2 = '2026-09-10T08:00:00.000Z';

function requireOk<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error('seed failed: ' + JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

/** 用真实领域操作播种，确保示例数据始终满足全部不变量。 */
export function buildSeed(): GBState {
  let s: GBState = { batches: [], signups: [], ledger: [], seq: 0 };

  // 批次 1：招募中（含候补）
  s = requireOk(
    createBatch(
      s,
      {
        name: 'GMK 暖铜 键帽团购',
        note: '原厂高度 · PBT 二色成型，暖铜色阳极点缀。',
        colors: [
          { name: '曜石黑', quota: 2 },
          { name: '奶油白', quota: 3 },
          { name: '复古绿', quota: 1 },
        ],
        tiers: [
          { upTo: 1, priceCents: yuanToCents(329) },
          { upTo: 2, priceCents: yuanToCents(309) },
          { upTo: null, priceCents: yuanToCents(289) },
        ],
        depositRatioPct: 30,
        balanceDeadline: '2026-11-20',
        shippingCents: yuanToCents(8),
      },
      T0,
    ),
  ).state;
  const b1 = s.batches[0];
  const [black, white, green] = b1.colors.map((c) => c.id);

  let r = requireOk(signup(s, b1.id, { participant: '阿强', colorId: black, qty: 1, contact: '@aq' }, T1));
  s = r.state;
  r = requireOk(signup(s, b1.id, { participant: '阿珍', colorId: black, qty: 1, contact: '@az' }, T1));
  s = r.state;
  // 黑色满，两个候补
  r = requireOk(signup(s, b1.id, { participant: '候补小明', colorId: black, qty: 1 }, T1));
  s = r.state;
  r = requireOk(signup(s, b1.id, { participant: '候补小红', colorId: black, qty: 1 }, T1));
  s = r.state;
  r = requireOk(signup(s, b1.id, { participant: '阿梅', colorId: white, qty: 2, contact: '@am' }, T1));
  s = r.state;
  // 绿色：并发争抢最后一席
  s = requireOk(
    competeForLastSeat(
      s,
      b1.id,
      [
        { participant: '并发阿杰', colorId: green, qty: 1 },
        { participant: '并发阿凯', colorId: green, qty: 1 },
      ],
      T1,
    ),
  ).state;

  // 前两名付了定金（329+8=337；30% = 101.1）
  const aq = s.signups.find((x) => x.participant === '阿强')!;
  const az = s.signups.find((x) => x.participant === '阿珍')!;
  s = requireOk(postPayment(s, aq.id, 'deposit', yuanToCents(101.1), 'WX-1001', T2)).state;
  s = requireOk(postPayment(s, az.id, 'deposit', yuanToCents(101.1), 'ZFB-2001', T2)).state;
  // 阿珍重复提交同一交易号（幂等示例：账务不应增加）
  s = requireOk(postPayment(s, az.id, 'deposit', yuanToCents(101.1), 'ZFB-2001', T2)).state;

  // 批次 2：生产中
  s = requireOk(
    createBatch(
      s,
      {
        name: 'SA 极地蓝 键帽团购',
        note: 'SA 高度球帽，ABS 双色注塑。',
        colors: [{ name: '冰川蓝', quota: 2 }],
        tiers: [
          { upTo: 1, priceCents: yuanToCents(459) },
          { upTo: null, priceCents: yuanToCents(429) },
        ],
        depositRatioPct: 40,
        balanceDeadline: '2026-10-15',
        shippingCents: yuanToCents(10),
      },
      T0,
    ),
  ).state;
  const b2 = s.batches[1];
  s = requireOk(signup(s, b2.id, { participant: '老周', colorId: b2.colors[0].id, qty: 1 }, T1)).state;
  s = requireOk(signup(s, b2.id, { participant: '老吴', colorId: b2.colors[0].id, qty: 1 }, T1)).state;
  const lz = s.signups.find((x) => x.participant === '老周')!;
  const lw = s.signups.find((x) => x.participant === '老吴')!;
  // 459+10=469；定金 40% = 187.6；尾款 281.4
  s = requireOk(postPayment(s, lz.id, 'deposit', yuanToCents(187.6), 'BANK-3001', T1)).state;
  s = requireOk(postPayment(s, lz.id, 'balance', yuanToCents(281.4), 'BANK-3002', T2)).state;
  s = requireOk(postPayment(s, lw.id, 'deposit', yuanToCents(187.6), 'BANK-3101', T1)).state;
  // 老吴欠尾款
  s = requireOk(transition(s, b2.id, 'locked', T2)).state;
  s = requireOk(transition(s, b2.id, 'production', T2)).state;

  return s;
}

export const EMPTY_GB_STATE: GBState = { batches: [], signups: [], ledger: [], seq: 0 };
