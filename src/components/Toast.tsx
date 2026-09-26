import { useEffect } from 'react';
import { useUi } from '../state/ui';
import styles from './Toast.module.css';

const TIMEOUT_MS = 6000;

/** Shows the single active toast from the UI store, bottom centre. */
export function ToastHost() {
  const toast = useUi((s) => s.toast);
  const dismiss = useUi((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismiss, TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div role="status" className={styles.toast}>
      <span>{toast.message}</span>
      {toast.actionLabel && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.onAction?.();
            dismiss();
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      {toast.linkLabel && (
        <button
          type="button"
          className={styles.link}
          onClick={() => {
            toast.onLink?.();
            dismiss();
          }}
        >
          {toast.linkLabel}
        </button>
      )}
    </div>
  );
}
