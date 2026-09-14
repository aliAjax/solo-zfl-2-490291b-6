import { create } from 'zustand';
import type {
  GBState,
  GroupBatch,
  Signup,
  BatchStatus,
  TxnKind,
  PriceTier,
  ColorOption,
  OpResult,
} from '@/groupbuy/types';
import * as engine from '@/groupbuy/engine';
import type { BatchDraft } from '@/groupbuy/engine';
import { buildSeed } from '@/groupbuy/seed';

const STORAGE_KEY = 'keyfeeling-groupbuy-v1';

export interface GBUiState {
  /** 团购弹窗/页面选中的批次 */
  selectedBatchId: string | null;
  modal: 'none' | 'createBatch' | 'editBatch' | 'signup' | 'payment' | 'refund';
  targetSignupId: string | null;
  /** 全局提示条 */
  toast: { tone: 'ok' | 'err'; text: string; key: number } | null;
}

interface ToastOptions {
  tone: 'ok' | 'err';
  text: string;
}

interface GBStore {
  data: GBState;
  ui: GBUiState;

  // 导航 / 弹窗
  selectBatch: (id: string | null) => void;
  openModal: (modal: GBUiState['modal'], signupId?: string | null) => void;
  closeModal: () => void;
  showToast: (t: ToastOptions) => void;

  // 批次
  createBatch: (draft: BatchDraft) => boolean;
  updateBatch: (
    id: string,
    patch: Partial<Pick<GroupBatch, 'name' | 'note' | 'tiers' | 'depositRatioPct' | 'balanceDeadline' | 'shippingCents' | 'colors'>>,
  ) => boolean;
  transition: (id: string, target: BatchStatus) => boolean;

  // 报名
  signup: (
    batchId: string,
    input: { participant: string; colorId: string; qty: number; contact?: string; address?: string },
  ) => boolean;
  cancelSignup: (signupId: string) => boolean;
  changeColor: (signupId: string, newColorId: string) => boolean;
  changeQty: (signupId: string, newQty: number) => boolean;
  updateAddress: (signupId: string, address: string) => boolean;
  updateContact: (signupId: string, patch: { participant?: string; contact?: string }) => boolean;
  markShipped: (signupId: string, trackingNo: string) => boolean;

  // 账务
  postPayment: (
    signupId: string,
    kind: Exclude<TxnKind, 'refund'>,
    amountCents: number,
    txnNo: string,
    note?: string,
  ) => boolean;
  postRefund: (signupId: string, amountCents: number, txnNo: string, note?: string) => boolean;

  resetDemo: () => void;
}

function loadData(): GBState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GBState;
      if (parsed && Array.isArray(parsed.batches)) return normalize(parsed);
    }
  } catch {
    // fall through to seed
  }
  return buildSeed();
}

function normalize(parsed: GBState): GBState {
  return {
    batches: parsed.batches ?? [],
    signups: parsed.signups ?? [],
    ledger: parsed.ledger ?? [],
    seq: typeof parsed.seq === 'number' ? parsed.seq : 0,
  };
}

function persist(data: GBState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

const initialUI: GBUiState = {
  selectedBatchId: null,
  modal: 'none',
  targetSignupId: null,
  toast: null,
};

function nowIso() {
  return new Date().toISOString();
}

export const useGBStore = create<GBStore>((set, get) => {
  /** 执行一次纯操作：成功才落库，并把提示写入 toast。 */
  const apply = (result: OpResult, closeOnOk = true): boolean => {
    if (result.ok) {
      persist(result.state);
      set((st) => ({
        data: result.state,
        ui: {
          ...st.ui,
          modal: closeOnOk ? 'none' : st.ui.modal,
          targetSignupId: closeOnOk ? null : st.ui.targetSignupId,
          toast: result.deduplicated
            ? { tone: 'ok', text: result.message ?? '重复交易，已幂等忽略', key: Date.now() }
            : result.message
              ? { tone: 'ok', text: result.message, key: Date.now() }
              : st.ui.toast,
        },
      }));
      return true;
    }
    set((st) => ({
      data: result.state,
      ui: { ...st.ui, toast: { tone: 'err', text: result.message, key: Date.now() } },
    }));
    return false;
  };

  return {
    data: loadData(),
    ui: initialUI,

    selectBatch: (id) => set((st) => ({ ui: { ...st.ui, selectedBatchId: id } })),
    openModal: (modal, signupId = null) =>
      set((st) => ({ ui: { ...st.ui, modal, targetSignupId: signupId } })),
    closeModal: () =>
      set((st) => ({ ui: { ...st.ui, modal: 'none', targetSignupId: null } })),
    showToast: (t) => set((st) => ({ ui: { ...st.ui, toast: { ...t, key: Date.now() } } })),

    createBatch: (draft) => {
      const r = engine.createBatch(get().data, draft, nowIso());
      const good = apply(r, true);
      if (good && r.ok) {
        set((st) => ({ ui: { ...st.ui, selectedBatchId: r.state.batches.at(-1)!.id } }));
      }
      return good;
    },

    updateBatch: (id, patch) => apply(engine.updateBatch(get().data, id, patch, nowIso())),

    transition: (id, target) => apply(engine.transition(get().data, id, target, nowIso())),

    signup: (batchId, input) => {
      const r = engine.signup(get().data, batchId, input, nowIso());
      return apply(r);
    },

    cancelSignup: (signupId) => apply(engine.cancelSignup(get().data, signupId, nowIso())),
    changeColor: (signupId, newColorId) =>
      apply(engine.changeColor(get().data, signupId, newColorId, nowIso())),
    changeQty: (signupId, newQty) =>
      apply(engine.changeQty(get().data, signupId, newQty, nowIso())),
    updateAddress: (signupId, address) =>
      apply(engine.updateAddress(get().data, signupId, address)),
    updateContact: (signupId, patch) => apply(engine.updateContact(get().data, signupId, patch)),
    markShipped: (signupId, trackingNo) =>
      apply(engine.markShipped(get().data, signupId, trackingNo, nowIso())),

    postPayment: (signupId, kind, amountCents, txnNo, note = '') =>
      apply(engine.postPayment(get().data, signupId, kind, amountCents, txnNo, nowIso(), note)),
    postRefund: (signupId, amountCents, txnNo, note = '') =>
      apply(engine.postRefund(get().data, signupId, amountCents, txnNo, nowIso(), note)),

    resetDemo: () => {
      const seed = buildSeed();
      persist(seed);
      set({ data: seed, ui: { ...initialUI } });
    },
  };
});

// ---------- 选择器 hook ----------

export function useBatch(batchId: string | null): GroupBatch | undefined {
  return useGBStore((s) => s.data.batches.find((b) => b.id === batchId));
}

export function useSignup(signupId: string | null): Signup | undefined {
  return useGBStore((s) => s.data.signups.find((x) => x.id === signupId));
}

export type { BatchDraft, ColorOption, PriceTier };

// 开发/浏览器自动化自检钩子：暴露纯引擎与 store，便于验证状态越级、并发等 UI 不暴露的路径。
if (typeof window !== 'undefined') {
  (window as unknown as { __GB__?: unknown }).__GB__ = { engine, store: useGBStore };
}
