import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import type { Toast as ToastType } from '../types';

interface ToastProps {
  toasts: ToastType[];
  onDismiss: (id: number) => void;
}

export default function ToastContainer({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 size={20} color="var(--accent-primary)" />;
      case 'error':
        return <AlertCircle size={20} color="var(--accent-danger)" />;
      default:
        return <Info size={20} color="var(--accent-secondary)" />;
    }
  };

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`} role="status">
          {getIcon(toast.type)}
          <div className="toast-message">{toast.message}</div>
          {toast.actionLabel && (
            <button
              className="toast-action"
              onClick={() => {
                toast.onAction?.();
                onDismiss(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button
            className="modal-close"
            onClick={() => onDismiss(toast.id)}
            aria-label="Закрыть уведомление"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}