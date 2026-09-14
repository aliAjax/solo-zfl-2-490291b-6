import { X } from 'lucide-react';
import { useGBStore } from '@/store/useGBStore';

export default function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxWidth = 'max-w-2xl',
}: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}) {
  const closeModal = useGBStore((s) => s.closeModal);
  const handleClose = onClose ?? closeModal;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className={`modal-surface ${maxWidth}`}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-ink-700/60 bg-ink-900/90 px-6 py-4 backdrop-blur">
          <div>
            <h2 className="font-mono text-base font-bold text-gradient-brass">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          <button
            onClick={handleClose}
            className="rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-700/50 hover:text-ink-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-ink-700/60 bg-ink-900/90 px-6 py-4 backdrop-blur">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
