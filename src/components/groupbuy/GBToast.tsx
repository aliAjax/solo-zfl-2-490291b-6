import { useEffect } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useGBStore } from '@/store/useGBStore';

export default function GBToast() {
  const toast = useGBStore((s) => s.ui.toast);
  const close = () => useGBStore.setState((st) => ({ ui: { ...st.ui, toast: null } }));

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(close, 3600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.key]);

  if (!toast) return null;

  const isOk = toast.tone === 'ok';
  return (
    <div
      key={toast.key}
      className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 animate-fadeIn"
    >
      <div
        className={`flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm shadow-card backdrop-blur-xl ${
          isOk
            ? 'border-moss-500/40 bg-ink-900/95 text-moss-400'
            : 'border-wine-500/40 bg-ink-900/95 text-wine-400'
        }`}
      >
        {isOk ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
        <span className="text-ink-100">{toast.text}</span>
        <button onClick={close} className="ml-1 text-ink-500 hover:text-ink-200">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
