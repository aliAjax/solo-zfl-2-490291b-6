import type { GroupBatch, PriceTier } from './types';

/** 元 -> 分（四舍五入到整数分） */
export function yuanToCents(yuan: number): number {
  return Math.round(yuan * 100);
}

/** 分 -> 元（字符串展示保留 2 位） */
export function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function roundCents(cents: number): number {
  return Math.round(cents);
}

/** 命中阶梯：按总数量找到对应档位（tier.upTo >= qty 的第一档） */
export function matchTier(tiers: PriceTier[], qty: number): PriceTier | null {
  const sorted = [...tiers].sort(
    (a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity),
  );
  for (const t of sorted) {
    if (t.upTo === null || qty <= t.upTo) return t;
  }
  return null;
}

/** 阶梯单价（分/件），未命中返回 0 */
export function unitPriceCents(batch: GroupBatch, qty: number): number {
  const tiers = batch.lockedTiers ?? batch.tiers;
  return matchTier(tiers, qty)?.priceCents ?? 0;
}

/** 商品总价（不含运费） */
export function goodsTotalCents(batch: GroupBatch, qty: number): number {
  return unitPriceCents(batch, qty) * qty;
}

/** 应收总额 = 商品 + 运费 */
export function receivableCents(batch: GroupBatch, qty: number): number {
  return goodsTotalCents(batch, qty) + batch.shippingCents;
}

/** 定金（应收 × 比例，四舍五入到分） */
export function depositDueCents(batch: GroupBatch, qty: number): number {
  return roundCents((receivableCents(batch, qty) * batch.depositRatioPct) / 100);
}

/** 尾款 = 应收 - 定金 */
export function balanceDueCents(batch: GroupBatch, qty: number): number {
  return receivableCents(batch, qty) - depositDueCents(batch, qty);
}
