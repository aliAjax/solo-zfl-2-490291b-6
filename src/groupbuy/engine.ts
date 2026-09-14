import type {
  GBState,
  GroupBatch,
  Signup,
  LedgerEntry,
  BatchStatus,
  ColorOption,
  PriceTier,
  TxnKind,
  OpResult,
  OpSuccess,
} from './types';
import { receivableCents, depositDueCents, balanceDueCents } from './money';

// ---------- 工具 ----------

export function clone<T>(v: T): T {
  return structuredClone(v);
}

function nextId(state: GBState, prefix: string): { id: string; seq: number } {
  const seq = state.seq + 1;
  return { id: `${prefix}${seq}`, seq };
}

function fail(state: GBState, code: string, message: string): OpResult {
  return { ok: false, state: clone(state), code, message };
}

function ok(state: GBState, extra?: Partial<OpResult>): OpResult {
  return { ok: true, state: clone(state), ...extra } as OpResult;
}

function getBatch(state: GBState, id: string): GroupBatch | undefined {
  return state.batches.find((b) => b.id === id);
}

function getSignup(state: GBState, id: string): Signup | undefined {
  return state.signups.find((s) => s.id === id);
}

export function colorOccupied(state: GBState, batchId: string, colorId: string): number {
  return state.signups
    .filter((s) => s.batchId === batchId && s.colorId === colorId && s.occupies)
    .reduce((n, s) => n + s.qty, 0);
}

export function waitlistQueue(state: GBState, batchId: string): Signup[] {
  return state.signups
    .filter((s) => s.batchId === batchId && s.status === 'waitlisted')
    .sort((a, b) => (a.waitlistSeq ?? 0) - (b.waitlistSeq ?? 0));
}

// ---------- 账务结算 ----------

export interface SignupSettlement {
  receivable: number;
  received: number;
  refunded: number;
  /** 净付 = 已收 - 退款 */
  netPaid: number;
  /** 剩余应付（欠款），不会为负 */
  due: number;
  depositDue: number;
  balanceDue: number;
  depositPaid: number;
  balancePaid: number;
  /** 已结清：净付 >= 应收 */
  settled: boolean;
  shipped: boolean;
}

export function signupSettlement(state: GBState, signupRef: Signup | string): SignupSettlement {
  const ref =
    typeof signupRef === 'string' ? signupRef : signupRef.id;
  const signup = state.signups.find((x) => x.id === ref);
  if (!signup) {
    return {
      receivable: 0, received: 0, refunded: 0, netPaid: 0, due: 0,
      depositDue: 0, balanceDue: 0, depositPaid: 0, balancePaid: 0,
      settled: false, shipped: false,
    };
  }
  const batch = getBatch(state, signup.batchId);
  const receivable = batch ? receivableCents(batch, signup.qty) : 0;
  const depositDue = batch ? depositDueCents(batch, signup.qty) : 0;
  const balanceDue = batch ? balanceDueCents(batch, signup.qty) : 0;

  const entries = state.ledger.filter((e) => e.signupId === signup.id);
  const received = entries
    .filter((e) => e.kind !== 'refund')
    .reduce((n, e) => n + e.amountCents, 0);
  const refunded = entries
    .filter((e) => e.kind === 'refund')
    .reduce((n, e) => n + e.amountCents, 0);

  const netPaid = received - refunded;
  const due = Math.max(receivable - netPaid, 0);
  const depositPaid = Math.min(Math.max(netPaid, 0), depositDue);
  const balancePaid = Math.min(Math.max(netPaid - depositDue, 0), balanceDue);

  return {
    receivable,
    received,
    refunded,
    netPaid,
    due,
    depositDue,
    balanceDue,
    depositPaid,
    balancePaid,
    settled: due === 0 && netPaid >= receivable,
    shipped: signup.shippedAt !== null,
  };
}

// ---------- 批次管理 ----------

export interface BatchDraft {
  name: string;
  note?: string;
  colors: { name: string; quota: number }[];
  tiers: PriceTier[];
  depositRatioPct: number;
  balanceDeadline: string;
  shippingCents: number;
}

export function validateDraft(draft: BatchDraft): string | null {
  if (!draft.name.trim()) return '批次名称不能为空';
  if (draft.colors.length === 0) return '至少需要一个配色';
  if (draft.colors.some((c) => !c.name.trim())) return '配色名称不能为空';
  if (draft.colors.some((c) => !Number.isInteger(c.quota) || c.quota <= 0))
    return '名额必须为正整数';
  if (draft.tiers.length === 0) return '至少需要一档阶梯价';
  if (draft.tiers.some((t) => t.priceCents < 0 || !Number.isInteger(t.priceCents)))
    return '单价必须为非负整数（分）';
  if (draft.depositRatioPct < 0 || draft.depositRatioPct > 100)
    return '定金比例需在 0–100 之间';
  if (draft.shippingCents < 0) return '运费不能为负';
  if (!draft.balanceDeadline) return '尾款截止日不能为空';
  return null;
}

export function createBatch(state: GBState, draft: BatchDraft, now: string): OpResult {
  const err = validateDraft(draft);
  if (err) return fail(state, 'INVALID_DRAFT', err);

  const s = clone(state);
  let seq = s.seq;
  const colors: ColorOption[] = draft.colors.map((c) => {
    seq += 1;
    return { id: `c${seq}`, name: c.name.trim(), quota: c.quota };
  });
  seq += 1;
  const id = `b${seq}`;
  const batch: GroupBatch = {
    id,
    name: draft.name.trim(),
    note: draft.note?.trim() ?? '',
    colors,
    tiers: clone(draft.tiers),
    lockedTiers: null,
    depositRatioPct: draft.depositRatioPct,
    balanceDeadline: draft.balanceDeadline,
    shippingCents: draft.shippingCents,
    status: 'recruiting',
    createdAt: now,
    updatedAt: now,
  };
  s.batches.push(batch);
  s.seq = seq;
  return ok(s, { message: `已创建批次 ${batch.name}` });
}

/** 仅招募中可改配置；名额不得低于已占，已被报名引用的配色不能删除。 */
export function updateBatch(
  state: GBState,
  batchId: string,
  patch: Partial<Pick<GroupBatch, 'name' | 'note' | 'tiers' | 'depositRatioPct' | 'balanceDeadline' | 'shippingCents' | 'colors'>>,
  now: string,
): OpResult {
  const batch = getBatch(state, batchId);
  if (!batch) return fail(state, 'NOT_FOUND', '批次不存在');
  if (batch.status !== 'recruiting')
    return fail(state, 'STATUS_LOCKED', '锁单后批次配置不可修改');

  const merged: BatchDraft = {
    name: patch.name ?? batch.name,
    note: patch.note ?? batch.note,
    colors: (patch.colors ?? batch.colors).map((c) => ({ name: c.name, quota: c.quota })),
    tiers: patch.tiers ?? batch.tiers,
    depositRatioPct: patch.depositRatioPct ?? batch.depositRatioPct,
    balanceDeadline: patch.balanceDeadline ?? batch.balanceDeadline,
    shippingCents: patch.shippingCents ?? batch.shippingCents,
  };
  const err = validateDraft(merged);
  if (err) return fail(state, 'INVALID_DRAFT', err);

  // 引用完整性 + 名额下限
  if (patch.colors) {
    for (const ref of state.signups.filter((x) => x.batchId === batchId)) {
      const kept = patch.colors.find((c) => c.id === ref.colorId);
      if (!kept) return fail(state, 'COLOR_IN_USE', '已有报名的配色不能删除');
    }
    for (const c of patch.colors) {
      if (c.quota < colorOccupied(state, batchId, c.id))
        return fail(state, 'QUOTA_TIGHTEN', `配色「${c.name}」名额不能少于已占位数量`);
    }
  }

  // 已收款保护：修改阶梯价/运费/定金比例后，任何「持有净付」的订单（含已取消订单）
  // 净付都不能高于新应收。差额已被退款覆盖（净付回落到新应收以内）才放行，
  // 否则阻止并说明至少还要退多少。
  if (
    patch.tiers !== undefined ||
    patch.shippingCents !== undefined ||
    patch.depositRatioPct !== undefined
  ) {
    const hypothetical: GroupBatch = {
      ...batch,
      tiers: clone(patch.tiers ?? batch.tiers),
      shippingCents: patch.shippingCents ?? batch.shippingCents,
      depositRatioPct: patch.depositRatioPct ?? batch.depositRatioPct,
      // 招募中尚无锁单快照，定价恒取 tiers
      lockedTiers: null,
    };
    for (const su of state.signups.filter((x) => x.batchId === batchId)) {
      const netPaid = signupSettlement(state, su).netPaid;
      if (netPaid <= 0) continue; // 未收款 / 已全额退款的订单不构成约束
      const newReceivable = receivableCents(hypothetical, su.qty);
      const needRefund = netPaid - newReceivable;
      if (needRefund > 0) {
        const cancelledTag = su.status === 'cancelled' ? '（该订单已取消，但仍有未退款）' : '';
        return fail(
          state,
          'WOULD_OVERPAY',
          `「${su.participant}」净付 ¥${(netPaid / 100).toFixed(2)}${cancelledTag}，改价后应收仅 ¥${(newReceivable / 100).toFixed(2)}；净付会高于应收，请先退款 ¥${(needRefund / 100).toFixed(2)} 差额（或提高对应阶梯价/运费）`,
        );
      }
    }
  }

  const s = clone(state);
  const b = s.batches.find((x) => x.id === batchId)!;
  if (patch.name !== undefined) b.name = patch.name.trim();
  if (patch.note !== undefined) b.note = patch.note;
  if (patch.tiers) b.tiers = clone(patch.tiers);
  if (patch.depositRatioPct !== undefined) b.depositRatioPct = patch.depositRatioPct;
  if (patch.balanceDeadline !== undefined) b.balanceDeadline = patch.balanceDeadline;
  if (patch.shippingCents !== undefined) b.shippingCents = patch.shippingCents;
  if (patch.colors) b.colors = clone(patch.colors);
  b.updatedAt = now;
  return ok(s);
}

// ---------- 报名 / 候补 / 补位 ----------

interface PlaceInput {
  participant: string;
  colorId: string;
  qty: number;
  contact?: string;
  address?: string;
}

/**
 * 报名输入 + 批次状态校验，报名与最后一席并发共用同一套规则：
 * 仅招募中可新增报名；参与者、数量、配色均需合法。
 * 返回 null 表示通过，否则返回错误码与中文说明。
 */
function validatePlaceInput(
  batch: GroupBatch,
  input: PlaceInput,
): { code: string; message: string } | null {
  if (batch.status === 'cancelled')
    return { code: 'BATCH_CANCELLED', message: '批次已取消，无法报名' };
  if (batch.status === 'completed')
    return { code: 'BATCH_COMPLETED', message: '批次已完成，无法报名' };
  if (batch.status !== 'recruiting')
    return { code: 'NOT_RECRUITING', message: '锁单后不能再新增报名' };
  if (!input.participant || !input.participant.trim())
    return { code: 'INVALID', message: '参与者名称不能为空' };
  if (!Number.isInteger(input.qty) || input.qty <= 0)
    return { code: 'INVALID', message: '数量必须为正整数' };
  if (!batch.colors.some((c) => c.id === input.colorId))
    return { code: 'INVALID_COLOR', message: '配色不存在' };
  return null;
}

function placeOne(
  s: GBState,
  batchId: string,
  input: PlaceInput,
  now: string,
): { signup: Signup; waitlisted: boolean } {
  const seq = s.seq + 1;
  s.seq = seq;
  const occupied = colorOccupied(s, batchId, input.colorId);
  const color = getBatch(s, batchId)!.colors.find((c) => c.id === input.colorId)!;
  const fits = occupied + input.qty <= color.quota;
  const signup: Signup = {
    id: `s${seq}`,
    batchId,
    colorId: input.colorId,
    participant: input.participant.trim(),
    qty: input.qty,
    address: input.address ?? '',
    contact: input.contact ?? '',
    status: fits ? 'active' : 'waitlisted',
    occupies: fits,
    waitlistSeq: fits ? null : seq, // seq 单调递增，保证候补 FIFO
    shippedAt: null,
    trackingNo: '',
    createdAt: now,
  };
  s.signups.push(signup);
  return { signup, waitlisted: !fits };
}

export function signup(
  state: GBState,
  batchId: string,
  input: PlaceInput,
  now: string,
): OpResult {
  const batch = getBatch(state, batchId);
  if (!batch) return fail(state, 'NOT_FOUND', '批次不存在');
  const vErr = validatePlaceInput(batch, input);
  if (vErr) return fail(state, vErr.code, vErr.message);

  const s = clone(state);
  const { signup: su, waitlisted } = placeOne(s, batchId, input, now);
  return ok(s, {
    message: waitlisted
      ? `名额已满，${su.participant} 已进入候补（序号 #${su.waitlistSeq}）`
      : `${su.participant} 已占位 ${input.qty} 件`,
  });
}

/**
 * 候补补位：按候补 FIFO 顺序依次尝试，每一步都基于最新占用量重新校验，
 * 名额不足则继续留在候补，直到没有可补的候选。
 * 最后一席在整个过程中至多被一个候补拿到。
 */
function fillWaitlist(s: GBState, batchId: string): string[] {
  const promoted: string[] = [];
  for (const cand of waitlistQueue(s, batchId)) {
    const color = getBatch(s, batchId)!.colors.find((c) => c.id === cand.colorId);
    if (!color) continue;
    const occupied = colorOccupied(s, batchId, cand.colorId);
    if (occupied + cand.qty <= color.quota) {
      const live = s.signups.find((x) => x.id === cand.id)!;
      live.status = 'active';
      live.occupies = true;
      live.waitlistSeq = null;
      promoted.push(live.id);
    }
  }
  return promoted;
}

export function cancelSignup(
  state: GBState,
  signupId: string,
  now: string,
): OpResult {
  const su = getSignup(state, signupId);
  if (!su) return fail(state, 'NOT_FOUND', '报名不存在');
  if (su.status === 'cancelled') return fail(state, 'ALREADY_CANCELLED', '该报名已取消');

  const s = clone(state);
  const target = s.signups.find((x) => x.id === signupId)!;
  target.status = 'cancelled';
  target.occupies = false;
  target.waitlistSeq = null;

  let promotedIds: string[] = [];
  if (su.status === 'active') {
    // 释放的是正式名额 -> 触发候补补位
    promotedIds = fillWaitlist(s, su.batchId);
  }
  void now;
  return ok(s, {
    promotedIds,
    message:
      promotedIds.length > 0
        ? `已取消，候补按顺序补位 ${promotedIds.length} 人`
        : '已取消报名',
  });
}

/** 锁单后不能改配色；换色需在目标配色仍有空位，换出后触发原配色候补补位。 */
export function changeColor(
  state: GBState,
  signupId: string,
  newColorId: string,
  now: string,
): OpResult {
  const su = getSignup(state, signupId);
  if (!su) return fail(state, 'NOT_FOUND', '报名不存在');
  const batch = getBatch(state, su.batchId);
  if (!batch) return fail(state, 'NOT_FOUND', '批次不存在');
  if (batch.status !== 'recruiting')
    return fail(state, 'LOCKED', '锁单后不能修改配色');
  if (su.status !== 'active') return fail(state, 'NOT_ACTIVE', '候补尚未占位，不能换色');
  if (su.colorId === newColorId) return ok(state);
  if (!batch.colors.some((c) => c.id === newColorId))
    return fail(state, 'INVALID_COLOR', '目标配色不存在');

  const free = batch.colors.find((c) => c.id === newColorId)!.quota
    - colorOccupied(state, su.batchId, newColorId);
  if (free < su.qty) return fail(state, 'NO_CAPACITY', '目标配色名额不足');

  const s = clone(state);
  s.signups.find((x) => x.id === signupId)!.colorId = newColorId;
  const promotedIds = fillWaitlist(s, su.batchId);
  void now;
  return ok(s, { promotedIds, message: '配色已修改' });
}

// ---------- 改数量（跨档） ----------

/**
 * 招募中修改数量，可能命中更低/更高阶梯（跨档）。
 * 账务流水完全不动：已收定金保留，只重新计算尚未结算的尾款（due 派生得出），
 * 即「跨档只调整未结算尾款，已收不重复扣减」。
 */
export function changeQty(
  state: GBState,
  signupId: string,
  newQty: number,
  now: string,
): OpResult {
  const su = getSignup(state, signupId);
  if (!su) return fail(state, 'NOT_FOUND', '报名不存在');
  const batch = getBatch(state, su.batchId);
  if (!batch) return fail(state, 'NOT_FOUND', '批次不存在');
  if (batch.status !== 'recruiting')
    return fail(state, 'LOCKED', '锁单后不能修改数量');
  if (su.status !== 'active') return fail(state, 'NOT_ACTIVE', '候补尚未占位');
  if (!Number.isInteger(newQty) || newQty <= 0)
    return fail(state, 'INVALID', '数量必须为正整数');
  if (newQty === su.qty) return ok(state);

  const usedByOthers = colorOccupied(state, su.batchId, su.colorId) - su.qty;
  const color = batch.colors.find((c) => c.id === su.colorId)!;
  if (usedByOthers + newQty > color.quota)
    return fail(state, 'NO_CAPACITY', '新数量超过该配色剩余名额');

  // 预先用新数量估算应收，避免净付超过新应收
  const prevNet = signupSettlement(state, su).netPaid;
  const newReceivable = receivableCents(batch, newQty);
  if (prevNet > newReceivable)
    return fail(
      state,
      'WOULD_OVERPAY',
      '降档后已收将超过应收，请先办理差额退款再改数量',
    );

  const s = clone(state);
  s.signups.find((x) => x.id === signupId)!.qty = newQty;
  // 减少数量会释放名额：立即按候补顺序补位，空位不留着。
  let promotedIds: string[] = [];
  if (newQty < su.qty) promotedIds = fillWaitlist(s, su.batchId);
  void now;
  return ok(s, {
    promotedIds,
    message:
      promotedIds.length > 0
        ? `数量已改为 ${newQty}，候补按顺序补位 ${promotedIds.length} 人`
        : `数量已改为 ${newQty}，尾款已按新档位重算`,
  });
}

/** 修改联系方式（地址由 updateAddress 单独约束发货） */
export function updateContact(
  state: GBState,
  signupId: string,
  patch: { participant?: string; contact?: string },
): OpResult {
  const su = getSignup(state, signupId);
  if (!su) return fail(state, 'NOT_FOUND', '报名不存在');
  const s = clone(state);
  const t = s.signups.find((x) => x.id === signupId)!;
  if (patch.participant !== undefined) t.participant = patch.participant.trim();
  if (patch.contact !== undefined) t.contact = patch.contact;
  return ok(s);
}

// ---------- 状态机 ----------

const FORWARD: Record<BatchStatus, BatchStatus | null> = {
  recruiting: 'locked',
  locked: 'production',
  production: 'shipping',
  shipping: 'completed',
  completed: null,
  cancelled: null,
};

/** 仅允许沿 招募→锁单→生产→发货→完成 逐级前进，不能越级。 */
export function transition(
  state: GBState,
  batchId: string,
  target: BatchStatus,
  now: string,
): OpResult {
  const batch = getBatch(state, batchId);
  if (!batch) return fail(state, 'NOT_FOUND', '批次不存在');
  if (target === 'cancelled') return cancelBatch(state, batchId, now);

  const expected = FORWARD[batch.status];
  if (expected !== target)
    return fail(
      state,
      'ILLEGAL_TRANSITION',
      `不能从「${batch.status}」越级到「${target}」`,
    );

  if (target === 'shipping') {
    const unpaid = state.signups.filter(
      (x) => x.batchId === batchId && x.occupies && signupSettlement(state, x).due > 0,
    );
    if (unpaid.length > 0)
      return fail(state, 'HAS_DEBT', `仍有 ${unpaid.length} 笔尾款未结清，不能进入发货`);
  }

  // 完成：所有正式订单必须已发货，未发货订单不能被永久锁死。
  if (target === 'completed') {
    const unshipped = state.signups.filter(
      (x) => x.batchId === batchId && x.occupies && !x.shippedAt,
    );
    if (unshipped.length > 0)
      return fail(
        state,
        'HAS_UNSHIPPED',
        `仍有 ${unshipped.length} 笔正式订单未发货，全部发货后才能完成`,
      );
  }

  const s = clone(state);
  const b = s.batches.find((x) => x.id === batchId)!;
  b.status = target;
  b.updatedAt = now;
  if (target === 'locked' && b.lockedTiers === null) b.lockedTiers = clone(b.tiers);
  return ok(s, { message: `批次已进入「${target}」` });
}

/** 取消：账务（流水保留）与名额（全部释放）保持一致。可从招募/锁单/生产取消。 */
export function cancelBatch(state: GBState, batchId: string, now: string): OpResult {
  const batch = getBatch(state, batchId);
  if (!batch) return fail(state, 'NOT_FOUND', '批次不存在');
  if (batch.status === 'completed') return fail(state, 'TERMINAL', '已完成批次不能取消');
  if (batch.status === 'cancelled') return fail(state, 'TERMINAL', '批次已取消');
  if (batch.status === 'shipping')
    return fail(state, 'SHIPPING', '已进入发货阶段不能直接取消');

  const s = clone(state);
  const b = s.batches.find((x) => x.id === batchId)!;
  b.status = 'cancelled';
  b.updatedAt = now;
  for (const su of s.signups.filter((x) => x.batchId === batchId)) {
    su.status = 'cancelled';
    su.occupies = false;
    su.waitlistSeq = null;
  }
  return ok(s, { message: '批次已取消，名额已释放，请按流水处理退款' });
}

// ---------- 交易流水（幂等 / 退款约束） ----------

export function postPayment(
  state: GBState,
  signupId: string,
  kind: Exclude<TxnKind, 'refund'>,
  amountCents: number,
  txnNo: string,
  now: string,
  note = '',
): OpResult {
  if (!txnNo.trim()) return fail(state, 'NO_TXN', '交易号不能为空');
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    return fail(state, 'INVALID_AMOUNT', '入账金额必须为正整数（分）');
  if (state.ledger.some((e) => e.txnNo === txnNo.trim()))
    return ok(state, { deduplicated: true, message: '交易号重复，已幂等忽略' });

  const su = getSignup(state, signupId);
  if (!su) return fail(state, 'NOT_FOUND', '报名不存在');
  const batch = getBatch(state, su.batchId);
  if (!batch) return fail(state, 'NOT_FOUND', '批次不存在');
  if (batch.status === 'cancelled') return fail(state, 'BATCH_CANCELLED', '批次已取消，不能收款');
  if (su.status !== 'active') return fail(state, 'NOT_ACTIVE', '仅正式占位的报名可入账');

  const set = signupSettlement(state, su);
  if (set.netPaid + amountCents > set.receivable)
    return fail(state, 'OVERPAID', '入账金额超过应收，不能重复收取');

  const s = clone(state);
  const id = nextId(s, 't');
  s.seq = id.seq;
  const entry: LedgerEntry = {
    id: id.id,
    batchId: su.batchId,
    signupId,
    txnNo: txnNo.trim(),
    kind,
    amountCents,
    note,
    createdAt: now,
  };
  s.ledger.push(entry);
  return ok(s, { message: '入账成功' });
}

/** 退款不能超过已收（净额）。批次取消后仍可退款用于结清。 */
export function postRefund(
  state: GBState,
  signupId: string,
  amountCents: number,
  txnNo: string,
  now: string,
  note = '',
): OpResult {
  if (!txnNo.trim()) return fail(state, 'NO_TXN', '交易号不能为空');
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    return fail(state, 'INVALID_AMOUNT', '退款金额必须为正整数（分）');
  if (state.ledger.some((e) => e.txnNo === txnNo.trim()))
    return ok(state, { deduplicated: true, message: '交易号重复，已幂等忽略' });

  const su = getSignup(state, signupId);
  if (!su) return fail(state, 'NOT_FOUND', '报名不存在');
  const batch = getBatch(state, su.batchId);
  if (!batch) return fail(state, 'NOT_FOUND', '批次不存在');

  const set = signupSettlement(state, su);
  const refundable = set.received - set.refunded; // 净已收
  if (amountCents > refundable)
    return fail(
      state,
      'REFUND_EXCEEDS_RECEIVED',
      `退款不能超过已收（最多可退 ${refundable} 分）`,
    );

  const s = clone(state);
  const id = nextId(s, 't');
  s.seq = id.seq;
  s.ledger.push({
    id: id.id,
    batchId: su.batchId,
    signupId,
    txnNo: txnNo.trim(),
    kind: 'refund',
    amountCents,
    note,
    createdAt: now,
  });
  return ok(s, { message: '退款成功' });
}

// ---------- 发货 ----------

export function updateAddress(
  state: GBState,
  signupId: string,
  address: string,
): OpResult {
  const su = getSignup(state, signupId);
  if (!su) return fail(state, 'NOT_FOUND', '报名不存在');
  if (su.shippedAt) return fail(state, 'SHIPPED', '发货后不能修改地址');
  const s = clone(state);
  s.signups.find((x) => x.id === signupId)!.address = address;
  return ok(s);
}

/** 欠款不能发货。 */
export function markShipped(
  state: GBState,
  signupId: string,
  trackingNo: string,
  now: string,
): OpResult {
  const su = getSignup(state, signupId);
  if (!su) return fail(state, 'NOT_FOUND', '报名不存在');
  const batch = getBatch(state, su.batchId);
  if (!batch) return fail(state, 'NOT_FOUND', '批次不存在');
  if (batch.status !== 'shipping')
    return fail(state, 'NOT_SHIPPING_PHASE', '批次未进入发货阶段');
  if (su.status !== 'active' || !su.occupies)
    return fail(state, 'NOT_ACTIVE', '候补/已取消报名不能发货');
  const set = signupSettlement(state, su);
  if (set.due > 0) return fail(state, 'HAS_DEBT', '存在欠款，不能发货');
  if (su.shippedAt) return fail(state, 'ALREADY_SHIPPED', '该单已发货');

  const s = clone(state);
  const target = s.signups.find((x) => x.id === signupId)!;
  target.shippedAt = now;
  target.trackingNo = trackingNo.trim();
  return ok(s, { message: '已发货' });
}

// ---------- 并发：最后一席 ----------

/**
 * 同一时刻多个请求争抢：在单个同步事务内按序处理，
 * 每次占位都基于事务内最新占用量判定。结果：恰好 1 人占位，其余候补。
 *
 * 复用报名阶段的批次状态 + 输入校验（validatePlaceInput / placeOne）：
 * 锁单、取消、完成后的请求一律拒绝；非法参与者/数量/配色也不会落库。
 * 非法请求记入 rejected，不影响其余合法请求的裁决。
 */
export function competeForLastSeat(
  state: GBState,
  batchId: string,
  requests: PlaceInput[],
  now: string,
): OpResult & { winnerId?: string } {
  const batch = getBatch(state, batchId);
  if (!batch)
    return fail(state, 'NOT_FOUND', '批次不存在') as OpResult & { winnerId?: string };

  const s = clone(state);
  const rejected: NonNullable<OpSuccess['rejected']> = [];
  let winnerId: string | undefined;
  requests.forEach((req, index) => {
    const vErr = validatePlaceInput(getBatch(s, batchId)!, req);
    if (vErr) {
      rejected.push({ index, ...vErr });
      return;
    }
    const { signup: su, waitlisted } = placeOne(s, batchId, req, now);
    if (!waitlisted && winnerId === undefined) winnerId = su.id;
  });
  const allRejected = rejected.length === requests.length && requests.length > 0;
  if (allRejected) {
    return {
      ...fail(state, rejected[0].code, rejected[0].message),
      rejected,
    } as OpResult & { winnerId?: string };
  }
  return {
    ...ok(s, {
      rejected: rejected.length ? rejected : undefined,
      message: rejected.length
        ? `${rejected.length} 个请求因状态/输入非法被拒绝，其余已裁决`
        : undefined,
    }),
    winnerId,
  } as OpResult & { winnerId?: string };
}

// ---------- 批次看板汇总 ----------

export interface BatchSummary {
  quota: number;
  occupied: number;
  free: number;
  waitlist: number;
  activeCount: number;
  receivable: number;
  received: number;
  refunded: number;
  debt: number;
  settledCount: number;
  shippedCount: number;
}

export function batchSummary(state: GBState, batchId: string): BatchSummary {
  const batch = getBatch(state, batchId);
  const active = state.signups.filter((s) => s.batchId === batchId && s.occupies);
  const waitlist = state.signups.filter(
    (s) => s.batchId === batchId && s.status === 'waitlisted',
  );
  // 名额相关口径只统计当前占位报名
  let receivable = 0;
  let debt = 0;
  let settledCount = 0;
  let shippedCount = 0;
  for (const su of active) {
    const set = signupSettlement(state, su);
    receivable += set.receivable;
    debt += set.due;
    if (set.settled) settledCount += 1;
    if (su.shippedAt) shippedCount += 1;
  }
  // 已收/退款直接按批次流水汇总：批次取消、报名取消后仍保留，账务不丢
  const batchEntries = state.ledger.filter((e) => e.batchId === batchId);
  const received = batchEntries
    .filter((e) => e.kind !== 'refund')
    .reduce((n, e) => n + e.amountCents, 0);
  const refunded = batchEntries
    .filter((e) => e.kind === 'refund')
    .reduce((n, e) => n + e.amountCents, 0);
  const quota = batch ? batch.colors.reduce((n, c) => n + c.quota, 0) : 0;
  const occupied = active.reduce((n, s) => n + s.qty, 0);
  return {
    quota,
    occupied,
    free: Math.max(quota - occupied, 0),
    waitlist: waitlist.length,
    activeCount: active.length,
    receivable,
    received,
    refunded,
    debt,
    settledCount,
    shippedCount,
  };
}

// ---------- 不变量校验（测试与自检） ----------

export function assertInvariants(state: GBState, label = ''): string[] {
  const errors: string[] = [];
  const tag = label ? `[${label}] ` : '';

  // 交易号全局唯一
  const txns = new Map<string, number>();
  for (const e of state.ledger) txns.set(e.txnNo, (txns.get(e.txnNo) ?? 0) + 1);
  for (const [no, n] of txns) if (n > 1) errors.push(`${tag}交易号重复: ${no} x${n}`);

  for (const batch of state.batches) {
    // 名额占用不超额
    for (const c of batch.colors) {
      const used = colorOccupied(state, batch.id, c.id);
      if (used > c.quota)
        errors.push(`${tag}配色 ${c.name} 超卖: ${used}/${c.quota}`);
    }
    // 已取消批次不应有占位
    if (batch.status === 'cancelled') {
      const used = state.signups
        .filter((x) => x.batchId === batch.id && x.occupies)
        .reduce((n, x) => n + x.qty, 0);
      if (used > 0) errors.push(`${tag}已取消批次仍占用名额 ${used}`);
    }
  }

  for (const su of state.signups) {
    const set = signupSettlement(state, su);
    if (set.refunded > set.received)
      errors.push(`${tag}${su.participant} 退款超过已收`);
    if (set.netPaid > set.receivable)
      errors.push(`${tag}${su.participant} 净付超过应收`);
    if (su.occupies !== (su.status === 'active'))
      errors.push(`${tag}${su.participant} occupies/status 不一致`);
    if (su.shippedAt && set.due > 0)
      errors.push(`${tag}${su.participant} 带欠款发货`);
    if (su.shippedAt) {
      const batch = getBatch(state, su.batchId);
      if (batch && batch.status !== 'shipping' && batch.status !== 'completed')
        errors.push(`${tag}${su.participant} 在非发货阶段被发货`);
    }
    if (su.status === 'waitlisted' && su.waitlistSeq === null)
      errors.push(`${tag}${su.participant} 候补缺少序号`);
  }
  return errors;
}
