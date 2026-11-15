import { useState } from 'react';
import { t } from '../i18n';
import { formatCount } from '../lib/format';
import type { ImagePair } from '../lib/types';
import styles from './ImageDiff.module.css';

/** `12 B`, `3.4 KB`, `1.2 MB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/** A changed image (SPEC §5 Review "Diff"): the old and the new one side by side, each with its
 * pixel size and file size; only one for an added or deleted image. */
export function ImageDiff({ image }: { image: ImagePair }) {
  return (
    <div className={styles.root}>
      {image.original && <Side label={t('diff.imageOld')} tone="old" src={image.original} bytes={image.originalSize} />}
      {image.modified && <Side label={t('diff.imageNew')} tone="new" src={image.modified} bytes={image.modifiedSize} />}
      {!image.original && !image.modified && <span className={styles.none}>{t('diff.binary')}</span>}
    </div>
  );
}

function Side({ label, tone, src, bytes }: { label: string; tone: 'old' | 'new'; src: string; bytes: number }) {
  // Its pixel size once decoded; `false` when the webview cannot draw it.
  const [size, setSize] = useState<{ w: number; h: number } | false | null>(null);
  return (
    <figure className={styles.side}>
      <figcaption className={`${styles.label} ${tone === 'old' ? styles.old : styles.new}`}>{label}</figcaption>
      <div className={styles.frame}>
        {size === false ? (
          <span className={styles.none}>{t('diff.binary')}</span>
        ) : (
          <img
            className={styles.img}
            src={src}
            alt={label}
            draggable={false}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setSize(false)}
          />
        )}
      </div>
      <span className={styles.meta}>
        {size ? `${formatCount(size.w)} × ${formatCount(size.h)} · ` : ''}
        {formatBytes(bytes)}
      </span>
    </figure>
  );
}
