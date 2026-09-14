/* 浏览器反例验证：四个边界缺口 + 不回归（跨档/退款/发货）。
 * UI 可触达的行为走真实点击；并发/状态矩阵走页面内打包后的同一套引擎。 */
import { chromium } from '/workspace/node_modules/playwright/index.mjs';

const EXE = '/home/node/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:5200';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.error('  ✗ ' + name + ' ' + extra); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const $ = (s) => page.locator(s).first();
const gst = () => page.evaluate(() => window.__GB__.store.getState());
const postPay = (id, amount, txn) =>
  page.evaluate(
    ({ id, amount, txn }) => window.__GB__.store.getState().postPayment(id, 'balance', amount, txn),
    { id, amount, txn },
  );
const E = () => page.evaluate(() => window.__GB__.engine);

await page.goto(BASE + '/groupbuy', { waitUntil: 'load' });
await page.waitForSelector('text=键帽团购');
await page.evaluate(() => localStorage.removeItem('keyfeeling-groupbuy-v1'));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('text=键帽团购');

// 用 UI 新建一个批次
async function createBatch(name, { quota = 5, colors = 1, price1 = '100', priceOpen = '80', ship = '5' } = {}) {
  if (await $('[data-testid="back-to-list"]').count()) {
    await $('[data-testid="back-to-list"]').click();
    await sleep(200);
  }
  await $('button:has-text("新建批次")').click();
  await page.waitForSelector('[data-testid="batch-name"]');
  await page.fill('[data-testid="batch-name"]', name);
  await page.fill('[data-testid="batch-color-name-0"]', '主色');
  await page.fill('[data-testid="batch-color-quota-0"]', String(quota));
  for (let i = 1; i < colors; i++) {
    await page.locator('button:has-text("添加配色")').first().click();
    await page.fill(`[data-testid="batch-color-name-${i}"]`, '副色' + i);
    await page.fill(`[data-testid="batch-color-quota-${i}"]`, String(quota));
  }
  await page.fill('[data-testid="batch-tier-price-0"]', price1);
  await page.fill('[data-testid="batch-tier-price-1"]', priceOpen);
  await page.fill('[data-testid="batch-deadline"]', '2026-12-31');
  await page.locator('.modal-surface input[type="number"][step="0.01"]').nth(2).fill(ship);
  await $('[data-testid="batch-submit"]').click();
  await sleep(400);
  return (await gst()).ui.selectedBatchId;
}
async function signupUI(name, qty, color = '主色') {
  await $('[data-testid="signup-open"]').click();
  await page.waitForSelector('[data-testid="signup-name"]');
  await page.fill('[data-testid="signup-name"]', name);
  await page.locator(`[data-testid="signup-color-${color}"]`).click();
  await page.fill('[data-testid="signup-qty"]', String(qty));
  await $('[data-testid="signup-confirm"]').click();
  await sleep(280);
}
const sidOf = async (n) => (await gst()).data.signups.find((x) => x.participant === n).id;

// ============ 反例 1：减量释放名额 → 候补必须按序补位，不留空位（真实 UI 改数量） ============
const b1 = await createBatch('边界团-补位', { quota: 5 });
await signupUI('一', 3);
await signupUI('二', 1);
await signupUI('三', 1);
await signupUI('候甲', 1);
await signupUI('候乙', 1);
await signupUI('候丙', 1);
let sum = await page.evaluate((b) => window.__GB__.engine.batchSummary(window.__GB__.store.getState().data, b), b1);
ok('补位前 占满5/候补3', sum.occupied === 5 && sum.waitlist === 3, JSON.stringify({ o: sum.occupied, w: sum.waitlist }));

const yi = await sidOf('一');
await $(`[data-testid="row-toggle-${yi}"]`).click();
await sleep(150);
await $(`[data-testid="qty-chip-${yi}"]`).click();
await page.fill(`[data-testid="qty-input-${yi}"]`, '1');
await $(`[data-testid="qty-save-${yi}"]`).click();
await sleep(400);
const afterReduce = await page.evaluate((b) => {
  const s = window.__GB__.store.getState();
  const e = window.__GB__.engine;
  const sm = e.batchSummary(s.data, b);
  const get = (n) => s.data.signups.find((x) => x.participant === n);
  return {
    occ: sm.occupied, wl: sm.waitlist,
    jia: get('候甲').occupies, yi2: get('候乙').occupies, bing: get('候丙').status,
  };
}, b1);
ok('减量2席后占用仍5（不留空位）', afterReduce.occ === 5, JSON.stringify(afterReduce));
ok('候甲、候乙按序补位', afterReduce.jia && afterReduce.yi2);
ok('候丙仍候补', afterReduce.bing === 'waitlisted');

// ============ 反例 3：已收款后改阶梯价/运费致净付超应收 → 阻止并说明（真实编辑弹窗） ============
// 先把 二（1件）全额付清 105
const er = await sidOf('二');
await postPay(er, 10500, 'EDGE-PAY');
await sleep(200);
ok('二已净收105', (await page.evaluate((id) => window.__GB__.engine.signupSettlement(window.__GB__.store.getState().data, id).netPaid, er)) === 10500);

async function editBatchPrice(t0, ship) {
  await $('button:has-text("编辑批次")').click();
  await page.waitForSelector('[data-testid="batch-name"]');
  await page.fill('[data-testid="batch-tier-price-0"]', t0);
  if (ship !== undefined) {
    await page.locator('.modal-surface input[type="number"][step="0.01"]').nth(2).fill(ship);
  }
  await $('[data-testid="batch-submit"]').click();
  await sleep(350);
}
await editBatchPrice('50'); // 应收降到55 < 净付105
ok('降价致净付超应收被拦截（toast）', (await page.locator('text=/净付.*高于应收|净付超过应收/').count()) >= 1);
// 失败保留弹窗，关闭
await page.locator('.modal-surface button:has-text("取消")').first().click();
await sleep(150);
const tierUnchanged = (await gst()).data.batches.find((x) => x.id === b1).tiers.find((t) => t.upTo === 1).priceCents;
ok('被拦截后阶梯价维持100', tierUnchanged === 10000, `got=${tierUnchanged}`);

// 降运费+降价仍超：单价100运费0=应收100 < 105
await $('button:has-text("编辑批次")').click();
await page.waitForSelector('[data-testid="batch-name"]');
await page.fill('[data-testid="batch-tier-price-0"]', '100');
await page.locator('.modal-surface input[type="number"][step="0.01"]').nth(2).fill('0');
await $('[data-testid="batch-submit"]').click();
await sleep(350);
ok('降运费致超额同样拦截', (await page.locator('text=/净付.*高于应收|净付超过应收|请先退款/').count()) >= 1);
await page.locator('.modal-surface button:has-text("取消")').first().click();
await sleep(150);

// 合法提价 120（应收125 ≥ 净付105）放行
await editBatchPrice('120');
ok('提价不超额时放行', (await gst()).data.batches.find((x) => x.id === b1).tiers.find((t) => t.upTo === 1).priceCents === 12000);
ok('提价后已收不重复扣减=105', (await page.evaluate((id) => window.__GB__.engine.signupSettlement(window.__GB__.store.getState().data, id).received, er)) === 10500);

// ============ 反例 2：全部正式订单发货后才能完成（真实状态按钮 + 发货按钮） ============
const b2 = await createBatch('边界团-完成', { quota: 2 });
await signupUI('完甲', 1);
await signupUI('完乙', 1);
const w1 = await sidOf('完甲');
const w2 = await sidOf('完乙');
for (const [id, tx] of [[w1, 'W1'], [w2, 'W2']]) {
  await postPay(id, 10500, tx);
}
await sleep(150);
// UI 逐级推进到发货
await $('[data-testid="transition-locked"]').click(); await sleep(200);
await $('[data-testid="transition-production"]').click(); await sleep(200);
await $('[data-testid="transition-shipping"]').click(); await sleep(250);
ok('进入发货阶段', (await gst()).data.batches.find((x) => x.id === b2).status === 'shipping');

const completeDisabled = () => $('[data-testid="transition-completed"]').isDisabled();
ok('零发货时完成按钮禁用', await completeDisabled());
// 引擎层面同样拒绝（绕过禁用点击也要挡住）
const block0 = await page.evaluate((b) => {
  const r = window.__GB__.engine.transition(window.__GB__.store.getState().data, b, 'completed', new Date().toISOString());
  return { ok: r.ok, code: r.code };
}, b2);
ok('引擎拒绝未全部发货完成', !block0.ok && block0.code === 'HAS_UNSHIPPED', JSON.stringify(block0));

// 发第一单：UI 卡车按钮
await $(`[data-testid="ship-${w1}"]`).click(); await sleep(120);
await $(`[data-testid="ship-confirm-${w1}"]`).click(); await sleep(250);
ok('发1单后完成按钮仍禁用（剩1单）', await completeDisabled());
const block1 = await page.evaluate((b) => {
  const r = window.__GB__.engine.transition(window.__GB__.store.getState().data, b, 'completed', new Date().toISOString());
  return { ok: r.ok, code: r.code };
}, b2);
ok('仍有1单未发货被拒', !block1.ok && block1.code === 'HAS_UNSHIPPED');
ok('未发货订单仍可发货（未锁死）', (await gst()).data.signups.find((x) => x.id === w2).shippedAt == null);

await $(`[data-testid="ship-${w2}"]`).click(); await sleep(120);
await $(`[data-testid="ship-confirm-${w2}"]`).click(); await sleep(250);
ok('全部发货后完成按钮可用', !(await completeDisabled()));
await $('[data-testid="transition-completed"]').click(); await sleep(250);
ok('全部发货后完成成功', (await gst()).data.batches.find((x) => x.id === b2).status === 'completed');

// ============ 反例 4：最后一席并发复用报名状态+输入校验 ============
// 4a 非法输入：空名/坏配色/数量0 不落库，合法请求唯一占位
const raceMixed = await page.evaluate(() => {
  const e = window.__GB__.engine;
  const cb = e.createBatch({ batches: [], signups: [], ledger: [], seq: 0 }, {
    name: 'RACE', note: '', colors: [{ name: 'X', quota: 1 }],
    tiers: [{ upTo: null, priceCents: 1000 }], depositRatioPct: 30,
    balanceDeadline: '2026-12-31', shippingCents: 0,
  }, new Date().toISOString());
  const b = cb.state.batches[0];
  const r = e.competeForLastSeat(cb.state, b.id, [
    { participant: 'p1', colorId: b.colors[0].id, qty: 1 },
    { participant: '', colorId: b.colors[0].id, qty: 1 },
    { participant: 'p2', colorId: 'bad-color', qty: 1 },
    { participant: 'p3', colorId: b.colors[0].id, qty: 0 },
  ], new Date().toISOString());
  return {
    ok: r.ok, occ: e.colorOccupied(r.state, b.id, b.colors[0].id),
    winners: r.state.signups.filter((x) => x.occupies).length,
    signups: r.state.signups.length,
    rejected: (r.rejected ?? []).map((x) => x.index + ':' + x.code),
    winner: r.winnerId && r.state.signups.find((x) => x.id === r.winnerId)?.participant,
  };
});
ok('并发：合法请求唯一占位', raceMixed.ok && raceMixed.occ === 1 && raceMixed.winners === 1, JSON.stringify(raceMixed));
ok('并发：3个非法请求被同一校验拒绝', raceMixed.rejected.length === 3, JSON.stringify(raceMixed.rejected));
ok('并发：非法输入未落库（仅1条报名）', raceMixed.signups === 1);
ok('并发：赢家为 p1', raceMixed.winner === 'p1');

// 4b 锁单 / 取消 / 完成后：并发与普通报名都拒绝，不能新增
const lifecycle = await page.evaluate(() => {
  const e = window.__GB__.engine;
  const mk = (q = 5) => {
    const cb = e.createBatch({ batches: [], signups: [], ledger: [], seq: 0 }, {
      name: 'L', note: '', colors: [{ name: 'X', quota: q }],
      tiers: [{ upTo: 1, priceCents: 10000 }, { upTo: null, priceCents: 8000 }],
      depositRatioPct: 30, balanceDeadline: '2026-12-31', shippingCents: 500,
    }, new Date().toISOString());
    return cb.state;
  };
  const out = {};
  // 锁单
  let s = mk(); let b = s.batches[0];
  s = e.signup(s, b.id, { participant: 'owner', colorId: b.colors[0].id, qty: 1 }, new Date().toISOString()).state;
  s = e.transition(s, b.id, 'locked', new Date().toISOString()).state;
  const lockedRace = e.competeForLastSeat(s, b.id, [{ participant: 'late', colorId: b.colors[0].id, qty: 1 }], new Date().toISOString());
  const lockedSignup = e.signup(s, b.id, { participant: 'late2', colorId: b.colors[0].id, qty: 1 }, new Date().toISOString());
  out.locked = { race: lockedRace.ok ? null : lockedRace.code, signup: lockedSignup.ok ? null : lockedSignup.code, n: s.signups.length };
  // 取消
  let s2 = mk(); const b2 = s2.batches[0];
  s2 = e.transition(s2, b2.id, 'cancelled', new Date().toISOString()).state;
  const cancelRace = e.competeForLastSeat(s2, b2.id, [{ participant: 'x', colorId: b2.colors[0].id, qty: 1 }], new Date().toISOString());
  const cancelSignup = e.signup(s2, b2.id, { participant: 'x', colorId: b2.colors[0].id, qty: 1 }, new Date().toISOString());
  out.cancelled = { race: cancelRace.ok ? null : cancelRace.code, signup: cancelSignup.ok ? null : cancelSignup.code };
  // 完成（需1单付清并发货）
  let s3 = mk(); const b3 = s3.batches[0];
  s3 = e.signup(s3, b3.id, { participant: 'k', colorId: b3.colors[0].id, qty: 1 }, new Date().toISOString()).state;
  const k = s3.signups[0].id;
  s3 = e.postPayment(s3, k, 'deposit', 3150, 'KD', new Date().toISOString()).state;
  s3 = e.postPayment(s3, k, 'balance', 7350, 'KB', new Date().toISOString()).state;
  s3 = e.transition(s3, b3.id, 'locked', new Date().toISOString()).state;
  s3 = e.transition(s3, b3.id, 'production', new Date().toISOString()).state;
  s3 = e.transition(s3, b3.id, 'shipping', new Date().toISOString()).state;
  s3 = e.markShipped(s3, k, 'T', new Date().toISOString()).state;
  s3 = e.transition(s3, b3.id, 'completed', new Date().toISOString()).state;
  const doneRace = e.competeForLastSeat(s3, b3.id, [{ participant: 'late', colorId: b3.colors[0].id, qty: 1 }], new Date().toISOString());
  const doneSignup = e.signup(s3, b3.id, { participant: 'late', colorId: b3.colors[0].id, qty: 1 }, new Date().toISOString());
  out.completed = { race: doneRace.ok ? null : doneRace.code, signup: doneSignup.ok ? null : doneSignup.code };
  return out;
});
ok('锁单后并发报名被拒(NOT_RECRUITING)', lifecycle.locked.race === 'NOT_RECRUITING', JSON.stringify(lifecycle.locked));
ok('锁单后普通报名被拒且未新增', lifecycle.locked.signup === 'NOT_RECRUITING' && lifecycle.locked.n === 1);
ok('取消后并发报名被拒(BATCH_CANCELLED)', lifecycle.cancelled.race === 'BATCH_CANCELLED', JSON.stringify(lifecycle.cancelled));
ok('取消后普通报名被拒', lifecycle.cancelled.signup === 'BATCH_CANCELLED');
ok('完成后并发报名被拒(BATCH_COMPLETED)', lifecycle.completed.race === 'BATCH_COMPLETED', JSON.stringify(lifecycle.completed));
ok('完成后普通报名被拒', lifecycle.completed.signup === 'BATCH_COMPLETED');

// 不变量终检（当前页面全部批次）
const inv = await page.evaluate(() => window.__GB__.engine.assertInvariants(window.__GB__.store.getState().data, 'edge-e2e'));
ok('全部批次不变量成立', inv.length === 0, inv.join('; '));

ok('全程无未捕获前端错误', errors.length === 0, errors.slice(0, 5).join(' | '));

console.log(`\n浏览器反例：通过 ${pass}，失败 ${fail}`);
if (fail) { console.error('失败:\n - ' + fails.join('\n - ')); process.exitCode = 1; }
else console.log('全部通过 ✅');
await browser.close();
