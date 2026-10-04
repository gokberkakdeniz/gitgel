import { useEffect } from 'react';
import { useUi } from '../state/ui';
import { CheckIcon, CloseIcon, SpinnerIcon } from './icons';
import styles from './Toast.module.css';

const TIMEOUT_MS = 6000;

/** Shows the single active toast from the UI store, bottom centre. */
export function ToastHost() {
  const toast = useUi((s) => s.toast);
  const dismiss = useUi((s) => s.dismissToast);

  useEffect(() => {
    // A running toast stays until it is replaced.
    if (!toast || toast.status === 'running') return;
    const timer = window.setTimeout(dismiss, TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div role="status" className={styles.toast}>
      <span className={styles.main}>
        {toast.status === 'running' && <SpinnerIcon className={`${styles.status} ${styles.running}`} />}
        {toast.status === 'success' && <CheckIcon className={`${styles.status} ${styles.success}`} />}
        {toast.status === 'failed' && <CloseIcon strokeWidth={2.2} className={`${styles.status} ${styles.failed}`} />}
        <span className={styles.lines}>
          <span>
            {toast.code && <span className={styles.code}>{toast.code}</span>}
            {toast.code && ' '}
            {toast.message}
          </span>
          {toast.sub && <span className={styles.sub}>{toast.sub}</span>}
        </span>
      </span>
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
