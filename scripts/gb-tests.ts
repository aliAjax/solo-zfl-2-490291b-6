// 纯逻辑测试：node 运行（esbuild 打包），不参与 tsc 构建。
import {
  createBatch,
  signup,
  cancelSignup,
  changeColor,
  changeQty,
  transition,
  postPayment,
  postRefund,
  updateAddress,
  markShipped,
  competeForLastSeat,
  updateBatch,
  batchSummary,
  signupSettlement,
  colorOccupied,
  waitlistQueue,
  assertInvariants,
  type GBState,
} from '../src/groupbuy/engine';
import type { BatchDraft } from '../src/groupbuy/engine';
import { yuanToCents } from '../src/groupbuy/money';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(name + (extra ? `  -> ${extra}` : ''));
    console.error(`  ✗ ${name} ${extra}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? '' : `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const NOW = '2026-09-14T10:00:00.000Z';
const empty: GBState = { batches: [], signups: [], ledger: [], seq: 0 };

function draft(over: Partial<BatchDraft> = {}): BatchDraft {
  return {
    name: 'GMK 测试团',
    colors: [
      { name: '曜石黑', quota: 1 },
      { name: '奶白', quota: 2 },
    ],
    // 1 件 100 元；2 件 90 元/件；3 件及以上 80 元/件
    tiers: [
      { upTo: 1, priceCents: yuanToCents(100) },
      { upTo: 2, priceCents: yuanToCents(90) },
      { upTo: null, priceCents: yuanToCents(80) },
    ],
    depositRatioPct: 30,
    balanceDeadline: '2026-12-01',
    shippingCents: yuanToCents(5),
    ...over,
  };
}

function makeBatch(over: Partial<BatchDraft> = {}) {
  const r = createBatch(empty, draft(over), NOW);
  if (!r.ok) throw new Error('setup createBatch failed: ' + r.message);
  const state = r.state;
  const batch = state.batches[0];
  return { state, batchId: batch.id, colorA: batch.colors[0].id, colorB: (batch.colors[1] ?? batch.colors[0]).id };
}

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error('expected ok but: ' + (r as Error & { message?: string }).message);
  return r as Extract<T, { ok: true }>;
}
function mustFail<T extends { ok: boolean }>(r: T, code: string) {
  check(`拒绝 ${code}`, !r.ok && (r as { code?: string }).code === code, JSON.stringify(r));
}

// ---------- 场景 1：跨档只调未结算尾款，已收不重复扣减 ----------
{
  const big = makeBatch({ colors: [{ name: '曜石黑', quota: 5 }] });
  const state = big.state;
  const batchId = big.batchId;
  const colorA = big.colorA;
  const r1 = must(signup(state, batchId, { participant: '阿强', colorId: colorA, qty: 1 }, NOW));
  const s1 = r1.state.signups[0];
  let set = signupSettlement(r1.state, s1);
  eq('1件 应收=105元', set.receivable, 10500);
  eq('1件 定金=31.5元', set.depositDue, 3150);
  eq('1件 尾款=73.5元', set.balanceDue, 7350);

  const paid = must(postPayment(r1.state, s1.id, 'deposit', 3150, 'TX-1', NOW));
  eq('定金入账后已收=31.5', signupSettlement(paid.state, s1).received, 3150);
  eq('定金入账后欠款=73.5', signupSettlement(paid.state, s1).due, 7350);

  // 升到 2 件 -> 命中 90 元档
  const up = must(changeQty(paid.state, s1.id, 2, NOW));
  set = signupSettlement(up.state, s1);
  eq('2件 应收=185元', set.receivable, 18500);
  eq('2件 定金=55.5元', set.depositDue, 5550);
  eq('跨档后已收不重复扣减=31.5', set.received, 3150);
  eq('跨档后流水仍只有1条', up.state.ledger.length, 1);
  eq('跨档后尾款(欠款)=153.5', set.due, 15350);

  // 再升到 3 件 -> 命中开放档 80 元/件
  const up3 = must(changeQty(up.state, s1.id, 3, NOW));
  set = signupSettlement(up3.state, s1);
  eq('3件 应收=245元', set.receivable, 24500);
  eq('3件 已收仍=31.5', set.received, 3150);
  // 回到 2 件继续后续断言
  const back2 = must(changeQty(up3.state, s1.id, 2, NOW));

  // 超额入账被拒
  mustFail(postPayment(back2.state, s1.id, 'balance', 20000, 'TX-2', NOW), 'OVERPAID');
  const full = must(postPayment(back2.state, s1.id, 'balance', 15350, 'TX-2', NOW));
  eq('补齐后结清', signupSettlement(full.state, s1).settled, true);

  // 降档：净付已超过新应收，必须先退款
  mustFail(changeQty(full.state, s1.id, 1, NOW), 'WOULD_OVERPAY');
  const refunded = must(postRefund(full.state, s1.id, 8000, 'RF-1', NOW));
  const down = must(changeQty(refunded.state, s1.id, 1, NOW));
  set = signupSettlement(down.state, s1);
  eq('退款后降档 应收=105', set.receivable, 10500);
  eq('退款后降档 净付=105', set.netPaid, 10500);
  eq('退款后降档 欠款=0', set.due, 0);
  eq('累计退款=80', set.refunded, 8000);
  check('全程不变量成立', assertInvariants(down.state, 'cross-tier').length === 0,
    assertInvariants(down.state).join('; '));
}

// ---------- 场景 2：候补顺序补位，最后一席不重复 ----------
{
  const { state, batchId, colorA } = makeBatch();
  const a = must(signup(state, batchId, { participant: '占位A', colorId: colorA, qty: 1 }, NOW));
  const b = must(signup(a.state, batchId, { participant: '候补甲', colorId: colorA, qty: 1 }, NOW));
  const c = must(signup(b.state, batchId, { participant: '候补乙', colorId: colorA, qty: 1 }, NOW));
  const idA = c.state.signups[0].id;
  const idB = c.state.signups[1].id;
  const idC = c.state.signups[2].id;
  eq('满额时占用=1', colorOccupied(c.state, batchId, colorA), 1);
  eq('候补队列2人', waitlistQueue(c.state, batchId).length, 2);
  eq('候补顺序 甲在前', waitlistQueue(c.state, batchId)[0].participant, '候补甲');

  const released = must(cancelSignup(c.state, idA, NOW));
  const after = released.state.signups;
  eq('补位后占用仍=1（最后一席不重复）', colorOccupied(released.state, batchId, colorA), 1);
  check('候补甲补位', after.find((x) => x.id === idB)?.occupies === true);
  check('候补乙仍候补', after.find((x) => x.id === idC)?.status === 'waitlisted');
  eq('补位只补1人', released.promotedIds?.length, 1);

  // 并发争抢最后一席：3 人同时抢 1 个名额
  const fresh = makeBatch();
  const conc = must(
    competeForLastSeat(
      fresh.state,
      fresh.batchId,
      [
        { participant: '并发1', colorId: fresh.colorA, qty: 1 },
        { participant: '并发2', colorId: fresh.colorA, qty: 1 },
        { participant: '并发3', colorId: fresh.colorA, qty: 1 },
      ],
      NOW,
    ),
  );
  const winners = conc.state.signups.filter((s) => s.occupies);
  eq('并发后仅1人占位', winners.length, 1);
  eq('并发占用量=1', colorOccupied(conc.state, fresh.batchId, fresh.colorA), 1);
  eq('唯一赢家=并发1', conc.winnerId, winners[0]?.id);
  eq('其余2人候补', conc.state.signups.filter((s) => s.status === 'waitlisted').length, 2);

  // 数量不匹配：2件请求进候补，随后 1 件请求可拿最后一席
  const fresh2 = makeBatch();
  const conc2 = must(
    competeForLastSeat(
      fresh2.state,
      fresh2.batchId,
      [
        { participant: '要两件', colorId: fresh2.colorA, qty: 2 },
        { participant: '要一件', colorId: fresh2.colorA, qty: 1 },
      ],
      NOW,
    ),
  );
  check('要两件者候补', conc2.state.signups[0].status === 'waitlisted');
  check('要一件者占位', conc2.state.signups[1].occupies === true);
  eq('占用量仍=1', colorOccupied(conc2.state, fresh2.batchId, fresh2.colorA), 1);
  check('候补补位不变量', assertInvariants(released.state, 'waitlist').length === 0);
  check('并发不变量', assertInvariants(conc.state, 'race').length === 0);
}

// ---------- 场景 3：交易号幂等，重复入账 ----------
{
  const { state, batchId, colorB } = makeBatch();
  const r = must(signup(state, batchId, { participant: '阿珍', colorId: colorB, qty: 1 }, NOW));
  const su = r.state.signups[0];
  const p1 = must(postPayment(r.state, su.id, 'deposit', 3150, 'DUP-1', NOW));
  const p2 = postPayment(p1.state, su.id, 'deposit', 3150, 'DUP-1', NOW);
  check('重复入账返回幂等标记', p2.ok && p2.deduplicated === true);
  eq('重复入账流水不增加', p2.state.ledger.length, 1);
  eq('重复入账已收不变', signupSettlement(p2.state, su).received, 3150);
  // 同号退款同样幂等
  const rf1 = must(postRefund(p1.state, su.id, 1000, 'DUP-2', NOW));
  const rf2 = postRefund(rf1.state, su.id, 1000, 'DUP-2', NOW);
  check('重复退款幂等', rf2.ok && rf2.deduplicated === true);
  eq('退款只记一次', signupSettlement(rf2.state, su).refunded, 1000);
}

// ---------- 场景 4：退款不能超过已收 ----------
{
  const { state, batchId, colorB } = makeBatch();
  const r = must(signup(state, batchId, { participant: '阿梅', colorId: colorB, qty: 1 }, NOW));
  const su = r.state.signups[0];
  mustFail(postRefund(r.state, su.id, 1, 'X', NOW), 'REFUND_EXCEEDS_RECEIVED');
  const paid = must(postPayment(r.state, su.id, 'deposit', 3150, 'P', NOW));
  mustFail(postRefund(paid.state, su.id, 3200, 'R1', NOW), 'REFUND_EXCEEDS_RECEIVED');
  const all = must(postRefund(paid.state, su.id, 3150, 'R2', NOW));
  eq('全额退净=0', signupSettlement(all.state, su).netPaid, 0);
  mustFail(postRefund(all.state, su.id, 1, 'R3', NOW), 'REFUND_EXCEEDS_RECEIVED');
}

// ---------- 场景 5：状态不能越级；锁单/发货约束；欠款不能发货 ----------
{
  const { state, batchId, colorA, colorB } = makeBatch();
  // 越级：招募 -> 生产
  mustFail(transition(state, batchId, 'production', NOW), 'ILLEGAL_TRANSITION');
  mustFail(transition(state, batchId, 'completed', NOW), 'ILLEGAL_TRANSITION');

  const r1 = must(signup(state, batchId, { participant: '阿强', colorId: colorA, qty: 1 }, NOW));
  const s1 = r1.state.signups[0];
  const r2 = must(signup(r1.state, batchId, { participant: '阿珍', colorId: colorB, qty: 1 }, NOW));
  const s2 = r2.state.signups[1];
  // 颜色 A 已被占满，阿珍换不过去
  mustFail(changeColor(r2.state, s2.id, colorA, NOW), 'NO_CAPACITY');
  // 阿强从 A 换到尚有空位的 B（换出后 A 空出，但无候补）
  const swap = changeColor(r2.state, s1.id, colorB, NOW);
  check('有空位可换色', swap.ok === true);

  const locked = must(transition(r2.state, batchId, 'locked', NOW));
  eq('锁单快照阶梯', locked.state.batches[0].lockedTiers?.length, 3);
  mustFail(changeColor(locked.state, s1.id, colorA, NOW), 'LOCKED');
  mustFail(changeQty(locked.state, s1.id, 2, NOW), 'LOCKED');

  const inProd = must(transition(locked.state, batchId, 'production', NOW));
  // 带欠款进入发货被拒
  mustFail(transition(inProd.state, batchId, 'shipping', NOW), 'HAS_DEBT');
  // 阿强付清，阿珍仍欠 -> 仍不能进入发货
  const s1Full = must(postPayment(inProd.state, s1.id, 'deposit', 3150, 'A1', NOW));
  const s1Bal = must(postPayment(s1Full.state, s1.id, 'balance', 7350, 'A2', NOW));
  mustFail(transition(s1Bal.state, batchId, 'shipping', NOW), 'HAS_DEBT');
  // 未到发货阶段，单标发货被拒
  mustFail(markShipped(s1Bal.state, s1.id, '', NOW), 'NOT_SHIPPING_PHASE');
  // 阿珍也付清
  const s2d = must(postPayment(s1Bal.state, s2.id, 'deposit', 3150, 'B1', NOW));
  const s2b = must(postPayment(s2d.state, s2.id, 'balance', 7350, 'B2', NOW));
  const shipping = must(transition(s2b.state, batchId, 'shipping', NOW));

  // 地址：发货前可改，发货后不可改
  must(updateAddress(shipping.state, s1.id, '上海市 xx 路'));
  const shipped1 = must(markShipped(shipping.state, s1.id, 'SF123', NOW));
  mustFail(updateAddress(shipped1.state, s1.id, '北京市 yy 路'), 'SHIPPED');

  // 给阿珍退款造成欠款，则不能发货
  const debt = must(postRefund(shipped1.state, s2.id, 100, 'BR', NOW));
  mustFail(markShipped(debt.state, s2.id, 'SF124', NOW), 'HAS_DEBT');
  // 补回后可发货
  const repay = must(postPayment(debt.state, s2.id, 'balance', 100, 'B3', NOW));
  const shipped2 = must(markShipped(repay.state, s2.id, 'SF124', NOW));
  const done = must(transition(shipped2.state, batchId, 'completed', NOW));
  mustFail(transition(done.state, batchId, 'cancelled', NOW), 'TERMINAL');
  check('状态流不变量', assertInvariants(done.state, 'fsm').length === 0,
    assertInvariants(done.state).join('; '));
}

// ---------- 场景 6：取消时账务与名额一致 ----------
{
  const { state, batchId, colorA } = makeBatch();
  const r1 = must(signup(state, batchId, { participant: '占位A', colorId: colorA, qty: 1 }, NOW));
  const r2 = must(signup(r1.state, batchId, { participant: '候补甲', colorId: colorA, qty: 1 }, NOW));
  const s1 = r2.state.signups[0];
  const paid = must(postPayment(r2.state, s1.id, 'deposit', 3150, 'C-DEP', NOW));
  const before = batchSummary(paid.state, batchId);
  eq('取消前占用1', before.occupied, 1);
  eq('取消前候补1', before.waitlist, 1);
  eq('取消前已收31.5', before.received, 3150);

  const cancelled = must(transition(paid.state, batchId, 'cancelled', NOW));
  const sum = batchSummary(cancelled.state, batchId);
  eq('取消后名额全释放 occupied=0', sum.occupied, 0);
  eq('取消后候补=0', sum.waitlist, 0);
  eq('取消后 active=0', sum.activeCount, 0);
  eq('取消后流水保留', cancelled.state.ledger.length, 1);
  eq('取消后看板已收仍=31.5（待退）', sum.received, 3150);
  eq('取消后看板退款=0', sum.refunded, 0);
  // 取消后仍可凭流水退款，且不得超额
  const refund = must(postRefund(cancelled.state, s1.id, 3150, 'C-RF', NOW));
  eq('取消后可全额退款', batchSummary(refund.state, batchId).refunded, 3150);
  check('取消一致性不变量', assertInvariants(refund.state, 'cancel').length === 0,
    assertInvariants(refund.state).join('; '));
}

// ---------- 看板汇总冒烟 ----------
{
  const { state, batchId, colorB } = makeBatch();
  const r = must(signup(state, batchId, { participant: '阿强', colorId: colorB, qty: 2 }, NOW));
  const su = r.state.signups[0];
  const paid = must(postPayment(r.state, su.id, 'deposit', 5550, 'D', NOW));
  const sum = batchSummary(paid.state, batchId);
  eq('看板 总名额=3(1+2)', sum.quota, 3);
  eq('看板 占用=2', sum.occupied, 2);
  eq('看板 剩余=1', sum.free, 1);
  eq('看板 应收=185', sum.receivable, 18500);
  eq('看板 已收=55.5', sum.received, 5550);
  eq('看板 欠款=129.5', sum.debt, 12950);
  eq('看板 退款=0', sum.refunded, 0);
}

// ---------- 反例 1：减少数量释放名额必须按顺序补位，空位不留 ----------
{
  const big = makeBatch({ colors: [{ name: '单色', quota: 5 }] });
  let s = big.state;
  const c = big.colorA;
  // 一 占 3，二/三 各占 1（共 5 满）；候甲、候乙、候丙 各候补 1
  s = must(signup(s, big.batchId, { participant: '一', colorId: c, qty: 3 }, NOW)).state;
  for (const n of ['二', '三']) s = must(signup(s, big.batchId, { participant: n, colorId: c, qty: 1 }, NOW)).state;
  for (const n of ['候甲', '候乙', '候丙']) s = must(signup(s, big.batchId, { participant: n, colorId: c, qty: 1 }, NOW)).state;
  const idOf = (n: string) => s.signups.find((x) => x.participant === n)!.id;
  eq('初始占用5', colorOccupied(s, big.batchId, c), 5);
  eq('初始候补3', waitlistQueue(s, big.batchId).length, 3);

  // 三 数量 1 -> 3（不释放），容量不足应被拒（5-1+3=7>5）
  mustFail(changeQty(s, idOf('三'), 3, NOW), 'NO_CAPACITY');

  // 一 数量 3 -> 1 释放 2 席 -> 候甲、候乙按序补位，候丙仍候补，空位=0
  const reduced = must(changeQty(s, idOf('一'), 1, NOW));
  s = reduced.state;
  eq('减量后占用仍5（不空位）', colorOccupied(s, big.batchId, c), 5);
  eq('减量触发2人补位', reduced.promotedIds?.length, 2);
  check('候甲补位', s.signups.find((x) => x.participant === '候甲')?.occupies === true);
  check('候乙补位', s.signups.find((x) => x.participant === '候乙')?.occupies === true);
  check('候丙仍候补', s.signups.find((x) => x.participant === '候丙')?.status === 'waitlisted');

  // 一 取消剩余 1 席 -> 候丙补位，正好满
  const canceled = must(cancelSignup(s, idOf('一'), NOW));
  eq('取消最后一席占用仍5', colorOccupied(canceled.state, big.batchId, c), 5);
  check('候丙补位', canceled.state.signups.find((x) => x.participant === '候丙')?.occupies === true);
  eq('候补清零', waitlistQueue(canceled.state, big.batchId).length, 0);
  check('减量补位不变量', assertInvariants(canceled.state, 'qty-fill').length === 0,
    assertInvariants(canceled.state).join('; '));
}

// ---------- 反例 2：全部正式订单发货后才能完成 ----------
{
  const big = makeBatch({ colors: [{ name: '单色', quota: 5 }] });
  let s = big.state;
  const c = big.colorA;
  for (const n of ['甲', '乙']) {
    s = must(signup(s, big.batchId, { participant: n, colorId: c, qty: 1 }, NOW)).state;
  }
  const ids = s.signups.map((x) => x.id);
  // 付清两单（105 全额）
  for (const id of ids) {
    s = must(postPayment(s, id, 'deposit', 3150, 'D' + id, NOW)).state;
    s = must(postPayment(s, id, 'balance', 7350, 'B' + id, NOW)).state;
  }
  s = must(transition(s, big.batchId, 'locked', NOW)).state;
  s = must(transition(s, big.batchId, 'production', NOW)).state;
  s = must(transition(s, big.batchId, 'shipping', NOW)).state;
  // 未发货不能完成
  mustFail(transition(s, big.batchId, 'completed', NOW), 'HAS_UNSHIPPED');
  check('未发货仍可发货（未被锁死）', s.signups.every((x) => !x.shippedAt));
  // 只发一单仍不能完成
  s = must(markShipped(s, ids[0], 'TRK1', NOW)).state;
  mustFail(transition(s, big.batchId, 'completed', NOW), 'HAS_UNSHIPPED');
  // 全部发货后完成
  s = must(markShipped(s, ids[1], 'TRK2', NOW)).state;
  s = must(transition(s, big.batchId, 'completed', NOW)).state;
  eq('全发货后状态=completed', s.batches[0].status, 'completed');
}

// ---------- 反例 3：已收款后改阶梯价/运费致净付超应收，必须阻止 ----------
{
  const big = makeBatch({ colors: [{ name: '单色', quota: 5 }] });
  let s = big.state;
  s = must(signup(s, big.batchId, { participant: '甲', colorId: big.colorA, qty: 1 }, NOW)).state;
  const id = s.signups[0].id;
  // 全额付清 105
  s = must(postPayment(s, id, 'deposit', 3150, 'PD', NOW)).state;
  s = must(postPayment(s, id, 'balance', 7350, 'PB', NOW)).state;
  // 把阶梯价降到 50（应收 55），净付 105 > 55 -> 阻止
  const lower = updateBatch(s, big.batchId, {
    tiers: [{ upTo: null, priceCents: yuanToCents(50) }],
  }, NOW);
  mustFail(lower, 'WOULD_OVERPAY');
  // 运费降到 0 且单价降到 100（应收 100）仍 < 105 -> 阻止
  const lowerShip = updateBatch(s, big.batchId, {
    tiers: [{ upTo: null, priceCents: yuanToCents(100) }],
    shippingCents: 0,
  }, NOW);
  mustFail(lowerShip, 'WOULD_OVERPAY');
  // 提价到 120（应收 125）净付 105 <= 125 -> 允许
  const higher = must(updateBatch(s, big.batchId, {
    tiers: [{ upTo: null, priceCents: yuanToCents(120) }],
  }, NOW));
  s = higher.state;
  eq('提价后应收=125', signupSettlement(s, id).receivable, 12500);
  check('提价后已收不重复扣减=105', signupSettlement(s, id).received === 10500);
  // 部分付款场景：净付 31.5，降价到应收 40（单价35+运费5）仍允许
  let s2 = big.state;
  s2 = must(signup(s2, big.batchId, { participant: '乙', colorId: big.colorA, qty: 1 }, NOW)).state;
  s2 = must(postPayment(s2, s2.signups[0].id, 'deposit', 3150, 'PD2', NOW)).state;
  const okLower = must(updateBatch(s2, big.batchId, {
    tiers: [{ upTo: null, priceCents: yuanToCents(35) }],
  }, NOW));
  eq('净付未超应收可降价，新应收=40', signupSettlement(okLower.state, s2.signups[0].id).receivable, 4000);
}

// ---------- 反例 4：最后一席并发复用报名状态/输入校验 ----------
{
  const big = makeBatch({ colors: [{ name: '单色', quota: 1 }] });
  const c = big.colorA;
  const reqs = [
    { participant: 'p1', colorId: c, qty: 1 },
    { participant: '', colorId: c, qty: 1 },                 // 非法：空名
    { participant: 'p2', colorId: 'no-such-color', qty: 1 }, // 非法：坏配色
    { participant: 'p3', colorId: c, qty: 0 },               // 非法：数量0
  ];
  const r = competeForLastSeat(big.state, big.batchId, reqs, NOW);
  check('含合法请求时整体仍裁决', r.ok === true);
  eq('唯一赢家 p1', r.winnerId, r.state.signups.find((x) => x.participant === 'p1')?.id);
  eq('3个非法请求被拒绝', r.rejected?.length, 3);
  eq('拒绝下标 1/2/3', (r.rejected ?? []).map((x) => x.index).join(','), '1,2,3');
  eq('占用量=1，非法没落库', colorOccupied(r.state, big.batchId, c), 1);
  eq('仅2条报名（p1占位 + 无候补因其余全非法）', r.state.signups.length, 1);

  // 锁单后并发：全部拒绝，不新增任何报名
  let s = big.state;
  s = must(signup(s, big.batchId, { participant: 'owner', colorId: c, qty: 1 }, NOW)).state;
  s = must(transition(s, big.batchId, 'locked', NOW)).state;
  const lockedRace = competeForLastSeat(s, big.batchId, [
    { participant: 'late1', colorId: c, qty: 1 },
    { participant: 'late2', colorId: c, qty: 1 },
  ], NOW);
  check('锁单后并发整体失败', lockedRace.ok === false);
  eq('锁单并发错误码 NOT_RECRUITING', (lockedRace as { code: string }).code, 'NOT_RECRUITING');
  eq('锁单后不新增报名', lockedRace.state.signups.length, 1);

  // 取消后并发
  let s2 = big.state;
  s2 = must(transition(s2, big.batchId, 'cancelled', NOW)).state;
  const cancelRace = competeForLastSeat(s2, big.batchId, [
    { participant: 'x', colorId: c, qty: 1 },
  ], NOW);
  check('取消后并发失败', cancelRace.ok === false);
  eq('取消并发码 BATCH_CANCELLED', (cancelRace as { code: string }).code, 'BATCH_CANCELLED');

  // 完成后并发（需要先造一个可完成批次）
  const done = makeBatch({ colors: [{ name: 'd', quota: 5 }] });
  let s3 = done.state;
  s3 = must(signup(s3, done.batchId, { participant: 'k', colorId: done.colorA, qty: 1 }, NOW)).state;
  const kid = s3.signups[0].id;
  s3 = must(postPayment(s3, kid, 'deposit', 3150, 'KD', NOW)).state;
  s3 = must(postPayment(s3, kid, 'balance', 7350, 'KB', NOW)).state;
  s3 = must(transition(s3, done.batchId, 'locked', NOW)).state;
  s3 = must(transition(s3, done.batchId, 'production', NOW)).state;
  s3 = must(transition(s3, done.batchId, 'shipping', NOW)).state;
  s3 = must(markShipped(s3, kid, 'T', NOW)).state;
  s3 = must(transition(s3, done.batchId, 'completed', NOW)).state;
  const doneRace = competeForLastSeat(s3, done.batchId, [
    { participant: 'late', colorId: done.colorA, qty: 1 },
  ], NOW);
  check('完成后并发失败', doneRace.ok === false);
  eq('完成并发码 BATCH_COMPLETED', (doneRace as { code: string }).code, 'BATCH_COMPLETED');
}

// ---------- 结果 ----------
console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  console.error('失败用例:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('全部通过 ✅');
