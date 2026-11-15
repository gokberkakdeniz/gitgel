import { useRef, useState } from 'react';
import { ResizeHandle, useStoredWidth } from '../components/ResizeHandle';
import { t } from '../i18n';
import { formatCount } from '../lib/format';
import type { ImagePair } from '../lib/types';
import styles from './ImageDiff.module.css';

/** The extensions shown as an image, as `files.rs` `image_mime` has them. */
const IMAGE = /\.(png|apng|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;
/** Whether a changed file shows as an image: a binary one with an image extension. */
export const showsAsImage = (file: { path: string; binary: boolean }) => file.binary && IMAGE.test(file.path);

/** `12 B`, `3.4 KB`, `1.2 MB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/** A changed image (SPEC §5 Review "Diff"): the pane in two halves, as a split diff, the old one
 * on the left and the new one on the right, each with its pixel size and file size; an added or
 * deleted image leaves the other half empty. */
export function ImageDiff({ image }: { image: ImagePair }) {
  const root = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null);
  // The left half's share of the pane in percent (15–85), remembered; half until dragged.
  const [share, setShare] = useStoredWidth('gitgel.imageDiffSplit');
  if (!image.original && !image.modified) return <div className={styles.root}>{t('diff.binary')}</div>;
  return (
    <div ref={root} className={styles.root}>
      <div ref={left} className={styles.half} style={{ flex: `0 0 ${share ?? 50}%` }}>
        {image.original && (
          <Side label={t('diff.imageOld')} tone="old" src={image.original} bytes={image.originalSize} />
        )}
      </div>
      <ResizeHandle
        pane={left}
        min={0}
        max={100000}
        onResize={(px) => {
          const width = root.current?.getBoundingClientRect().width;
          if (width) setShare(Math.min(85, Math.max(15, (px / width) * 100)));
        }}
        onReset={() => setShare(null)}
        label={t('diff.imageResize')}
      />
      <div className={`${styles.half} ${styles.right}`}>
        {image.modified && (
          <Side label={t('diff.imageNew')} tone="new" src={image.modified} bytes={image.modifiedSize} />
        )}
      </div>
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
