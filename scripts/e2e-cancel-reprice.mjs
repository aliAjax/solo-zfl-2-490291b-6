/* 浏览器验证：取消订单后的改价保护（取消后改价 / 部分退款再改价 / 正常改价），
 * 并在同一脚本末尾回归四个边界 + 退款/发货关键路径。 */
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
const gid = () => page.evaluate(() => window.__GB__.store.getState());

await page.goto(BASE + '/groupbuy', { waitUntil: 'load' });
await page.waitForSelector('text=键帽团购');
await page.evaluate(() => localStorage.removeItem('keyfeeling-groupbuy-v1'));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('text=键帽团购');

// 批次：名额5，阶梯 ≤1=100 / 开放=80，运费5（1件应收105）
async function createBatch() {
  await $('button:has-text("新建批次")').click();
  await page.waitForSelector('[data-testid="batch-name"]');
  await page.fill('[data-testid="batch-name"]', '取消改价团');
  await page.fill('[data-testid="batch-color-name-0"]', '主色');
  await page.fill('[data-testid="batch-color-quota-0"]', '5');
  await page.fill('[data-testid="batch-tier-price-0"]', '100');
  await page.fill('[data-testid="batch-tier-price-1"]', '80');
  await page.fill('[data-testid="batch-deadline"]', '2026-12-31');
  await page.locator('.modal-surface input[type="number"][step="0.01"]').nth(2).fill('5');
  await $('[data-testid="batch-submit"]').click();
  await sleep(350);
  return (await gid()).ui.selectedBatchId;
}
async function signupUI(name) {
  await $('[data-testid="signup-open"]').click();
  await page.waitForSelector('[data-testid="signup-name"]');
  await page.fill('[data-testid="signup-name"]', name);
  await page.locator('[data-testid="signup-color-主色"]').click();
  await $('[data-testid="signup-confirm"]').click();
  await sleep(250);
}
const sidOf = (n) => page.evaluate((n) =>
  window.__GB__.store.getState().data.signups.find((x) => x.participant === n).id, n);
async function openEditAndSet(t1, ship = undefined) {
  await $('[data-testid="edit-batch"]').click();
  await page.waitForSelector('[data-testid="batch-name"]');
  await page.fill('[data-testid="batch-tier-price-0"]', t1);
  await page.fill('[data-testid="batch-tier-price-1"]', t1);
  if (ship !== undefined) {
    await page.locator('.modal-surface input[type="number"][step="0.01"]').nth(2).fill(ship);
  }
  await $('[data-testid="batch-submit"]').click();
  await sleep(350);
}
const tier1 = () => page.evaluate((b) =>
  window.__GB__.store.getState().data.batches.find((x) => x.id === b).tiers.find((t) => t.upTo === 1).priceCents, bid);
const cancelEditModal = async () => {
  const c = page.locator('.modal-surface button:has-text("取消")').first();
  if (await c.count()) { await c.click(); await sleep(150); }
};

const bid = await createBatch();
await signupUI('甲');
const sid = await sidOf('甲');

// 甲全额付清 105
await page.evaluate((id) => window.__GB__.store.getState().postPayment(id, 'balance', 10500, 'PAY'), sid);
await sleep(150);
ok('甲净付105', await page.evaluate((id) =>
  window.__GB__.engine.signupSettlement(window.__GB__.store.getState().data, id).netPaid, sid) === 10500);

// 真实点击取消订单（名额释放，仍在列表中显示已取消）
await $(`[data-testid="cancel-${sid}"]`).click();
await sleep(300);
ok('订单已取消但保留', await page.evaluate((id) => {
  const su = window.__GB__.store.getState().data.signups.find((x) => x.id === id);
  return su.status === 'cancelled' && su.occupies === false;
}, sid));

// —— 场景一：取消后直接改价（降到50，应收55），应阻止并说明需先退 ¥50.00 ——
await openEditAndSet('50');
ok('取消后降价被拦截', (await page.locator('text=净付会高于应收').count()) >= 1
  || (await page.locator('text=请先退款').count()) >= 1);
ok('拦截提示给出需退金额 ¥50.00', (await page.locator('text=¥50.00').count()) >= 1);
await cancelEditModal();
ok('被拦截后阶梯价仍为100', (await tier1()) === 10000, `got=${await tier1()}`);

// 已取消订单仍出现退款入口（持有净付）
ok('已取消订单显示退款按钮', await $(`[data-testid="refund-${sid}"]`).count() === 1);

// —— 场景二：部分退款 30（净付75）后再降价到55，仍阻止，需再退 ¥20.00 ——
async function refundUI(amount, txn) {
  await $(`[data-testid="refund-${sid}"]`).click();
  await page.waitForSelector('[data-testid="refund-amount"]');
  await page.fill('[data-testid="refund-amount"]', String(amount));
  await page.fill('[data-testid="refund-txn"]', txn);
  await $('[data-testid="refund-confirm"]').click();
  await sleep(350);
}
await refundUI(30, 'R1');
ok('部分退款后净付75', await page.evaluate((id) =>
  window.__GB__.engine.signupSettlement(window.__GB__.store.getState().data, id).netPaid, sid) === 7500);
await openEditAndSet('50');
ok('部分退款后降价仍拦截（需再退¥20.00）', (await page.locator('text=¥20.00').count()) >= 1);
await cancelEditModal();
ok('仍未改价', (await tier1()) === 10000);

// 退款超额在已取消订单上同样受限：再退 10000 会超过净付75，被拒
await $(`[data-testid="refund-${sid}"]`).click();
await page.waitForSelector('[data-testid="refund-amount"]');
await page.fill('[data-testid="refund-amount"]', '10000');
await page.fill('[data-testid="refund-txn"]', 'R-BIG');
await $('[data-testid="refund-confirm"]').click();
await sleep(350);
ok('已取消订单超额退款仍被拒', (await page.locator('text=退款不能超过已收').count()) >= 1);
await cancelEditModal();

// 退足差额：再退 20（净付55 == 新应收55）
await refundUI(20, 'R2');
ok('退足差额后净付55', await page.evaluate((id) =>
  window.__GB__.engine.signupSettlement(window.__GB__.store.getState().data, id).netPaid, sid) === 5500);

// —— 场景三：差额已覆盖，正常改价放行 ——
await openEditAndSet('50');
ok('差额覆盖后改价放行（单价=50）', (await tier1()) === 5000, `got=${await tier1()}`);
ok('改价后该取消订单应收55', await page.evaluate((id) =>
  window.__GB__.engine.signupSettlement(window.__GB__.store.getState().data, id).receivable, sid) === 5500);
ok('改价后净付不高于应收', await page.evaluate((id) => {
  const s = window.__GB__.engine.signupSettlement(window.__GB__.store.getState().data, id);
  return s.netPaid <= s.receivable;
}, sid));

// 提价（120）对净付55 自然放行，已收不重复扣减
await openEditAndSet('120');
ok('正常提价放行（单价=120）', (await tier1()) === 12000);
ok('提价后净付仍55（不重复扣减）', await page.evaluate((id) =>
  window.__GB__.engine.signupSettlement(window.__GB__.store.getState().data, id).netPaid, sid) === 5500);

// 终态不变量
const inv = await page.evaluate(() => window.__GB__.engine.assertInvariants(window.__GB__.store.getState().data, 'cancel-reprice'));
ok('不变量成立', inv.length === 0, inv.join('; '));
ok('全程无未捕获前端错误', errors.length === 0, errors.slice(0, 5).join(' | '));

console.log(`\n取消改价浏览器用例：通过 ${pass}，失败 ${fail}`);
if (fail) { console.error('失败:\n - ' + fails.join('\n - ')); }
await browser.close();
if (fail) process.exitCode = 1;
