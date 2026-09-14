/* 浏览器端到端验证：真实页面点击（data-testid）+ window.__GB__ 引擎钩子 */
import { chromium } from '/workspace/node_modules/playwright/index.mjs';

const EXE = '/home/node/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:5200';

let pass = 0;
let fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.error('  ✗ ' + name + ' ' + extra); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cancelModal() {
  const b = page.locator('.modal-surface button:has-text("取消")').first();
  if (await b.count()) await b.click().catch(() => {});
  await sleep(150);
}

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR')) consoleErrors.push('console: ' + m.text()); });

const $ = (sel) => page.locator(sel).first();
const state = () => page.evaluate(() => window.__GB__.store.getState());
const eng = () => page.evaluate(() => window.__GB__.engine);

// ---------- 0. 回归：原键盘日志首页 ----------
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForSelector('text=KeyFeeling', { timeout: 10000 });
ok('回归：键盘日志首页仍渲染卡片', (await page.locator('.card-surface').count()) > 0);
ok('回归：顶栏出现团购入口', (await page.locator('a[href="/groupbuy"]').count()) === 1);
await page.locator('a[href="/groupbuy"]').first().click();
await page.waitForURL('**/groupbuy');
await page.waitForSelector('text=键帽团购');
ok('团购页打开', (await page.locator('h2').first().innerText()).includes('键帽团购'));

// 干净起点：清空 localStorage 再刷新，随后用 UI 新建
await page.evaluate(() => localStorage.removeItem('keyfeeling-groupbuy-v1'));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('text=键帽团购');

// ---------- 新建受控批次：配色 黑曜石1 / 奶白3；阶梯 1件100 / ≥2件80；定金30%；运费5 ----------
async function createE2EBatch() {
  await $('button:has-text("新建批次")').click();
  await page.waitForSelector('[data-testid="batch-name"]');
  await page.fill('[data-testid="batch-name"]', 'E2E 验证团');
  await page.fill('[data-testid="batch-color-name-0"]', '黑曜石');
  await page.fill('[data-testid="batch-color-quota-0"]', '1');
  await page.locator('button:has-text("添加配色")').first().click();
  await page.fill('[data-testid="batch-color-name-1"]', '奶白');
  await page.fill('[data-testid="batch-color-quota-1"]', '3');
  await page.fill('[data-testid="batch-tier-price-0"]', '100');
  await page.fill('[data-testid="batch-tier-price-1"]', '80');
  await page.fill('[data-testid="batch-deadline"]', '2026-12-31');
  // 运费是模态中第三个 step=0.01（两档单价之后）
  const nums = page.locator('.modal-surface input[type="number"][step="0.01"]');
  await nums.nth(2).fill('5');
  await $('[data-testid="batch-submit"]').click();
  await sleep(400);
}
await createE2EBatch();
ok('创建后进入详情', (await page.locator('h2').first().innerText()).includes('E2E 验证团'));
const batchId = (await state()).ui.selectedBatchId;
const id = {
  yi: async () => (await state()).data.signups.find((x) => x.participant === '乙').id,
};

// ---------- 1. 占位 / 候补 / 补位 / 最后一席 ----------
async function signupUI(name, color, qty) {
  await $('[data-testid="signup-open"]').click();
  await page.waitForSelector('[data-testid="signup-name"]');
  await page.fill('[data-testid="signup-name"]', name);
  await page.locator(`[data-testid="signup-color-${color}"]`).click();
  await page.fill('[data-testid="signup-qty"]', String(qty));
  await $('[data-testid="signup-confirm"]').click();
  await sleep(300);
}
await signupUI('甲', '黑曜石', 1);
await signupUI('乙', '黑曜石', 1); // 候补
await signupUI('丙', '黑曜石', 1); // 候补

let sum = await page.evaluate((b) => window.__GB__.engine.batchSummary(window.__GB__.store.getState().data, b), batchId);
ok('满额占用=1', sum.occupied === 1, `occ=${sum.occupied}`);
let queue = await page.evaluate((b) => window.__GB__.engine.waitlistQueue(window.__GB__.store.getState().data, b).length, batchId);
ok('候补2人', queue === 2, `wl=${queue}`);

const jiaId = (await state()).data.signups.find((x) => x.participant === '甲').id;
await $(`[data-testid="cancel-${jiaId}"]`).click();
await sleep(400);
const after = await page.evaluate((b) => {
  const s = window.__GB__.store.getState();
  const sm = window.__GB__.engine.batchSummary(s.data, b);
  return {
    occ: sm.occupied,
    yi: s.data.signups.find((x) => x.participant === '乙').occupies,
    bing: s.data.signups.find((x) => x.participant === '丙').status,
  };
}, batchId);
ok('释放后占用仍=1（最后一席不重复）', after.occ === 1, JSON.stringify(after));
ok('乙按候补顺序补位', after.yi === true);
ok('丙仍候补', after.bing === 'waitlisted');

// ---------- 2. 跨档（真实 UI 改色 + 改数量） ----------
const yiId = await id.yi();
await $(`[data-testid="row-toggle-${yiId}"]`).click(); // 展开
await sleep(150);
// 乙换到奶白（余3）
await $(`[data-testid="color-chip-${yiId}"]`).click();
const milkId = (await state()).data.batches.find((b) => b.id === batchId).colors.find((c) => c.name === '奶白').id;
await page.selectOption(`[data-testid="color-select-${yiId}"]`, milkId);
await sleep(300);
ok('乙换到奶白', (await state()).data.signups.find((x) => x.id === yiId).colorId === milkId);
// 改数量 1 -> 2，命中 80 元档
await $(`[data-testid="qty-chip-${yiId}"]`).click();
await page.fill(`[data-testid="qty-input-${yiId}"]`, '2');
await $(`[data-testid="qty-save-${yiId}"]`).click();
await sleep(300);
ok('（UI）乙数量改为2', (await state()).data.signups.find((x) => x.id === yiId).qty === 2);
const recv = await page.evaluate((sid) =>
  window.__GB__.engine.signupSettlement(window.__GB__.store.getState().data, sid).receivable, yiId);
ok('跨档应收=165.00（2×80+5运费）', recv === 16500, `recv=${recv}`);

// ---------- 3. 入账 + 幂等 + 超额 ----------
async function pay(amount, txn, expectOk = true) {
  await $(`[data-testid="pay-${yiId}"]`).click();
  await page.waitForSelector('[data-testid="pay-amount"]');
  await page.fill('[data-testid="pay-amount"]', String(amount));
  await page.fill('[data-testid="pay-txn"]', txn);
  await $('[data-testid="pay-confirm"]').click();
  await sleep(350);
  if (!expectOk) await cancelModal();
}
const settle = async () => page.evaluate((sid) =>
  window.__GB__.engine.signupSettlement(window.__GB__.store.getState().data, sid), yiId);

await pay(49.5, 'T1'); // 165*30%=49.5
ok('定金已收49.5', (await settle()).received === 4950);
await pay(49.5, 'T1'); // 重复交易号
ok('重复交易号幂等：已收仍49.5', (await settle()).received === 4950);
ok('T1流水仅1条', (await state()).data.ledger.filter((x) => x.txnNo === 'T1').length === 1);
ok('出现幂等提示', (await page.locator('text=幂等').count()) >= 1);
await pay(9999, 'T2', false); // 超额
ok('超额入账被拒：已收仍49.5', (await settle()).received === 4950);
ok('出现超额错误提示', (await page.locator('text=超过应收').count()) >= 1);

// ---------- 4. 超额退款 ----------
async function refund(amount, txn, expectOk = true) {
  await $(`[data-testid="refund-${yiId}"]`).click();
  await page.waitForSelector('[data-testid="refund-amount"]');
  await page.fill('[data-testid="refund-amount"]', String(amount));
  await page.fill('[data-testid="refund-txn"]', txn);
  await $('[data-testid="refund-confirm"]').click();
  await sleep(350);
  if (!expectOk) await cancelModal();
}
await refund(100, 'R1', false);
ok('超额退款被拒：退款仍0', (await settle()).refunded === 0);
ok('出现超额退款提示', (await page.locator('text=退款不能超过已收').count()) >= 1);
await refund(49.5, 'R2');
ok('全额退款后净付=0', (await settle()).netPaid === 0);

// ---------- 5. 状态机：越级拒绝 / 锁单禁改色 / 欠款禁发货 / 发货禁改地址 ----------
const skip = await page.evaluate((b) => {
  const e = window.__GB__.engine;
  const s0 = window.__GB__.store.getState().data;
  const r = e.transition(s0, b, 'production', new Date().toISOString());
  return { ok: r.ok, code: r.code, status: s0.batches.find((x) => x.id === b).status };
}, batchId);
ok('状态越级 招募→生产 被拒', !skip.ok && skip.code === 'ILLEGAL_TRANSITION', JSON.stringify(skip));
ok('越级后状态仍招募中', skip.status === 'recruiting');

await $('[data-testid="transition-locked"]').click();
await sleep(300);
ok('UI 逐级进入锁单', (await state()).data.batches.find((x) => x.id === batchId).status === 'locked');
ok('锁单生成价格快照', (await state()).data.batches.find((x) => x.id === batchId).lockedTiers.length === 2);
const lockErr = await page.evaluate(({ sid, cid }) => {
  const r = window.__GB__.engine.changeColor(window.__GB__.store.getState().data, sid, cid, new Date().toISOString());
  return { ok: r.ok, code: r.code };
}, { sid: yiId, cid: (await state()).data.batches.find((x) => x.id === batchId).colors.find((c) => c.name === '黑曜石').id });
ok('锁单后改配色被拒', !lockErr.ok && lockErr.code === 'LOCKED', JSON.stringify(lockErr));

// 带欠款（乙净付0）进入发货被拒
await $('[data-testid="transition-production"]').click();
await sleep(300);
const debtBlock = await page.evaluate((b) => {
  const r = window.__GB__.engine.transition(window.__GB__.store.getState().data, b, 'shipping', new Date().toISOString());
  return { ok: r.ok, code: r.code };
}, batchId);
ok('有欠款进入发货被拒(HAS_DEBT)', !debtBlock.ok && debtBlock.code === 'HAS_DEBT', JSON.stringify(debtBlock));

// 通过 store action 补齐 165（仍走幂等/超额引擎），再用 UI 推进
await page.evaluate((sid) => window.__GB__.store.getState().postPayment(sid, 'balance', 16500, 'T3'), yiId);
await sleep(200);
ok('补齐后乙已结清', (await settle()).settled === true);

// 乙换色时释放的黑曜石名额触发候补补位，丙被自动补位且尚未付款。
// 结清所有仍有欠款的正式占位（验证多单欠款清零后才允许发货）。
const debtorsPaid = await page.evaluate((b) => {
  const s = window.__GB__.store.getState();
  const e = window.__GB__.engine;
  let n = 0;
  for (const su of s.data.signups.filter((x) => x.batchId === b && x.occupies)) {
    const d = e.signupSettlement(s.data, su.id).due;
    if (d > 0) {
      const good = s.postPayment(su.id, 'balance', d, 'PAYALL-' + su.id);
      if (good) n++;
    }
  }
  return n;
}, batchId);
ok('候补补位产生的其余欠款已全部结清', debtorsPaid >= 1, `paid=${debtorsPaid}`);

await $('[data-testid="transition-shipping"]').click();
await sleep(300);
ok('结清后可进入发货', (await state()).data.batches.find((x) => x.id === batchId).status === 'shipping');

// 发货（乙）：先写地址（store action），UI 点发货
await page.evaluate((sid) => window.__GB__.store.getState().updateAddress(sid, '上海市浦东新区'), yiId);
await $(`[data-testid="ship-${yiId}"]`).click();
await sleep(150);
await $(`[data-testid="ship-confirm-${yiId}"]`).click();
await sleep(300);
ok('乙已发货', !!(await state()).data.signups.find((x) => x.id === yiId).shippedAt);
const addrErr = await page.evaluate((sid) => {
  const r = window.__GB__.engine.updateAddress(window.__GB__.store.getState().data, sid, '北京市');
  return { ok: r.ok, code: r.code };
}, yiId);
ok('发货后改地址被拒', !addrErr.ok && addrErr.code === 'SHIPPED', JSON.stringify(addrErr));

// ---------- 6. 取消批次：账务与名额一致 ----------
await $('[data-testid="back-to-list"]').click();
await sleep(300);
await $('button:has-text("新建批次")').click();
await page.waitForSelector('[data-testid="batch-name"]');
await page.fill('[data-testid="batch-name"]', '取消一致性团');
await page.fill('[data-testid="batch-color-name-0"]', '单色');
await page.fill('[data-testid="batch-color-quota-0"]', '1');
await page.fill('[data-testid="batch-tier-price-0"]', '50');
await page.fill('[data-testid="batch-tier-price-1"]', '50');
await page.fill('[data-testid="batch-deadline"]', '2026-12-31');
await page.locator('.modal-surface input[type="number"][step="0.01"]').nth(2).fill('0');
await $('[data-testid="batch-submit"]').click();
await sleep(400);
await signupUI('丁', '单色', 1);
await signupUI('戊', '单色', 1); // 候补
const dingId = (await state()).data.signups.find((x) => x.participant === '丁').id;
await page.evaluate((sid) => window.__GB__.store.getState().postPayment(sid, 'deposit', 1650, 'C1'), dingId);
await sleep(200);
await $('[data-testid="cancel-batch-start"]').click();
await sleep(150);
await $('[data-testid="cancel-batch-confirm"]').click();
await sleep(400);
const cons = await page.evaluate(() => {
  const s = window.__GB__.store.getState();
  const e = window.__GB__.engine;
  const b = s.data.batches.find((x) => x.name === '取消一致性团');
  const sm = e.batchSummary(s.data, b.id);
  const inv = e.assertInvariants(s.data, 'ui-cancel');
  const rf = e.postRefund(s.data, s.data.signups.find((x) => x.participant === '丁').id, 1650, 'C2', new Date().toISOString());
  return {
    status: b.status, occ: sm.occupied, wl: sm.waitlist, received: sm.received,
    invariants: inv, refundOk: rf.ok, refundedAfter: e.batchSummary(rf.state, b.id).refunded,
  };
});
ok('取消后状态cancelled', cons.status === 'cancelled');
ok('取消后名额全释放=0', cons.occ === 0, `occ=${cons.occ}`);
ok('取消后候补清零', cons.wl === 0);
ok('取消后流水保留 已收仍16.5', cons.received === 1650, `r=${cons.received}`);
ok('取消后可全额退款', cons.refundOk && cons.refundedAfter === 1650);
ok('取消一致性不变量成立', cons.invariants.length === 0, cons.invariants.join(';'));

// ---------- 7. 最后一席：真实同步并发（引擎事务内串行裁决） ----------
const race = await page.evaluate(() => {
  const e = window.__GB__.engine;
  const cb = e.createBatch({ batches: [], signups: [], ledger: [], seq: 0 }, {
    name: 'RACE', note: '', colors: [{ name: 'X', quota: 1 }],
    tiers: [{ upTo: null, priceCents: 1000 }], depositRatioPct: 30,
    balanceDeadline: '2026-12-31', shippingCents: 0,
  }, new Date().toISOString());
  const b = cb.state.batches[0];
  const r = e.competeForLastSeat(cb.state, b.id, [
    { participant: 'p1', colorId: b.colors[0].id, qty: 1 },
    { participant: 'p2', colorId: b.colors[0].id, qty: 1 },
    { participant: 'p3', colorId: b.colors[0].id, qty: 1 },
  ], new Date().toISOString());
  const winners = r.state.signups.filter((x) => x.occupies);
  return {
    occ: e.colorOccupied(r.state, b.id, b.colors[0].id),
    winners: winners.length,
    winner: winners[0]?.participant,
    wl: r.state.signups.filter((x) => x.status === 'waitlisted').length,
    inv: e.assertInvariants(r.state, 'race'),
  };
});
ok('并发最后一席：占用=1', race.occ === 1, JSON.stringify(race));
ok('并发：唯一赢家 p1', race.winners === 1 && race.winner === 'p1', JSON.stringify(race));
ok('并发：其余2人候补', race.wl === 2);
ok('并发不变量成立', race.inv.length === 0, race.inv.join(';'));

// 看板字段齐备
const dash = await page.evaluate(() => {
  const s = window.__GB__.store.getState();
  const b = s.data.batches.find((x) => x.name === 'E2E 验证团');
  return window.__GB__.engine.batchSummary(s.data, b.id);
});
ok('看板含 名额/应收/已收/欠款/退款',
  ['quota', 'receivable', 'received', 'debt', 'refunded'].every((k) => k in dash), JSON.stringify(dash));

// 截图取证
await page.goto(BASE + '/groupbuy', { waitUntil: 'load' });
await sleep(400);
await page.screenshot({ path: '/tmp/shot-list.png' });
await page.locator('button:has-text("E2E 验证团")').first().click();
await sleep(500);
await page.screenshot({ path: '/tmp/shot-detail.png', fullPage: true });

ok('全程无未捕获前端错误', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

console.log(`\n浏览器用例：通过 ${pass}，失败 ${fail}`);
if (fail) { console.error('失败:\n - ' + fails.join('\n - ')); process.exitCode = 1; }
else console.log('全部通过 ✅');
await browser.close();
