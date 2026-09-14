// 键帽团购 / 分期结算 —— 领域类型定义
// 所有金额一律使用「分」(整数) 存储，避免浮点误差。

export type BatchStatus =
  | 'recruiting' // 招募中
  | 'locked' // 锁单
  | 'production' // 生产中
  | 'shipping' // 发货中
  | 'completed' // 完成
  | 'cancelled'; // 取消

export type SignupStatus = 'active' | 'waitlisted' | 'cancelled';

export type TxnKind = 'deposit' | 'balance' | 'refund';

/** 阶梯单价：数量 <= upTo 时命中本档；最后一档 upTo = null 表示开放上限 */
export interface PriceTier {
  upTo: number | null;
  priceCents: number;
}

export interface ColorOption {
  id: string;
  name: string;
  quota: number;
}

export interface GroupBatch {
  id: string;
  name: string;
  note: string;
  colors: ColorOption[];
  /** 招募期间可编辑的阶梯价 */
  tiers: PriceTier[];
  /** 锁单瞬间快照，锁单后按此价格结算 */
  lockedTiers: PriceTier[] | null;
  depositRatioPct: number;
  /** 尾款截止日 yyyy-mm-dd */
  balanceDeadline: string;
  /** 每单运费（分） */
  shippingCents: number;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Signup {
  id: string;
  batchId: string;
  colorId: string;
  participant: string;
  qty: number;
  address: string;
  contact: string;
  status: SignupStatus;
  /** 是否占有名额（active=true 才占位） */
  occupies: boolean;
  /** 候补序号，越小越靠前（FIFO） */
  waitlistSeq: number | null;
  shippedAt: string | null;
  trackingNo: string;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  batchId: string;
  signupId: string;
  /** 外部交易号，全局唯一；重复交易号幂等忽略 */
  txnNo: string;
  kind: TxnKind;
  /** 恒为正数（分）；退款也记正数，靠 kind 区分 */
  amountCents: number;
  note: string;
  createdAt: string;
}

export interface GBState {
  batches: GroupBatch[];
  signups: Signup[];
  ledger: LedgerEntry[];
  /** 自增序列，用于候补 FIFO 与 id 生成 */
  seq: number;
}

// ---------- 结果封装 ----------

export interface OpSuccess {
  ok: true;
  state: GBState;
  /** 幂等命中（交易号重复）时为 true，账务未发生变化 */
  deduplicated?: boolean;
  promotedIds?: string[];
  message?: string;
}

export interface OpFailure {
  ok: false;
  state: GBState;
  code: string;
  message: string;
}

export type OpResult = OpSuccess | OpFailure;

export const STATUS_LABELS: Record<BatchStatus, string> = {
  recruiting: '招募中',
  locked: '已锁单',
  production: '生产中',
  shipping: '发货中',
  completed: '已完成',
  cancelled: '已取消',
};

export const STATUS_ORDER: BatchStatus[] = [
  'recruiting',
  'locked',
  'production',
  'shipping',
  'completed',
];
