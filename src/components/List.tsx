import { useState, type ComponentProps, type HTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react';
import { DragHandle } from '../scripts/DragHandle';
import { Button, type ButtonVariant } from './Button';
import { IconButton } from './IconButton';
import { IconTile } from './IconTile';
import { Icon, type IconName } from './icons';
import { Input, type InputProps } from './Input';
import { Pill, type PillTone } from './Pill';
import { Switch } from './Switch';
import styles from './List.module.css';

export type ListDensity = 'regular' | 'compact';

/** A control at the end of a row. Buttons are 28px (24px compact); an icon with no label is an
 * `IconButton`. `element` is for a control the design does not have yet. */
export type ListAction =
  | {
      kind?: 'button';
      icon?: IconName;
      label?: string;
      variant?: ButtonVariant;
      ariaLabel: string;
      title?: string;
      disabled?: boolean;
      /** Its menu is open. */
      active?: boolean;
      onPress?: (e: MouseEvent<HTMLButtonElement>) => void;
    }
  | { kind: 'switch'; checked: boolean; ariaLabel: string; title?: string; disabled?: boolean; onToggle: (on: boolean) => void }
  | { kind: 'pill'; label: string; tone: PillTone; title?: string }
  | { kind: 'element'; element: ReactNode };

/** A part of the mono meta line under the title; `·` goes between parts. */
export type ListSubPart = { pill: string; tone?: PillTone } | { text: string };

export interface ListRowProps {
  /** A drag grip before the lead (a list the user reorders): the handle's props (`useReorder`). */
  handle?: ComponentProps<typeof DragHandle>;
  /** index: mono 11 faint `leadText` · icon: a 14px line icon · tile: a 28px boxed icon. */
  lead?: 'none' | 'index' | 'icon' | 'tile';
  leadText?: string;
  icon?: IconName;
  /** Mono 12 muted, before the title (e.g. stash@{0}). */
  prefix?: string;
  title: string;
  /** Mono 12 for branches and refs. */
  titleMono?: boolean;
  /** 500 for names. */
  titleWeight?: 400 | 500;
  /** A fixed title width so the `detail` column lines up. */
  titleWidth?: number;
  /** sm Pills after the title. */
  badges?: { label: string; tone: PillTone; mono?: boolean }[];
  /** Mono 12 muted, takes the rest of line 1 (e.g. a path). */
  detail?: string;
  sub?: ListSubPart[];
  /** 12px text before the actions. */
  aside?: string;
  asideTone?: 'muted' | 'faint' | 'warning' | 'danger';
  actions?: ListAction[];
  /** Actions stay hidden until the row is hovered or holds focus. */
  actionsOnHover?: boolean;
  /** Hovered or its menu is open. */
  active?: boolean;
  /** Switched off: dims the tile and the title. */
  off?: boolean;
  density?: ListDensity;
}

/** A List item: a row plus its React key and any attributes for its `<li>` (`data-reorder`, a
 * class while it is dragged). */
export type ListItem = Omit<ListRowProps, 'density'> & {
  key: string;
  rowProps?: HTMLAttributes<HTMLLIElement> & { [data: `data-${string}`]: string | boolean | undefined };
};

interface ListProps {
  items: ListItem[];
  /** The list's accessible name; defaults to the heading. */
  label?: string;
  density?: ListDensity;
  /** 12, or 10 for a narrow list (Default base). */
  radius?: 10 | 12;
  width?: number | string;
  /** A disclosure above the card, with the item count; collapsing hides the card. */
  heading?: string;
  /** With `onToggle` the heading is controlled; without, it keeps its own state. */
  collapsed?: boolean;
  onToggle?: () => void;
  /** One muted row when there are no items. */
  empty?: ReactNode;
  /** A last row with a link button ("+ Add …"). */
  addLabel?: string;
  onAdd?: () => void;
  /** While adding, the add row is a 28px mono Input with these props. */
  adding?: Omit<InputProps, 'size' | 'mono'>;
  /** A numbered list (`<ol>`). */
  ordered?: boolean;
  /** The `<ul>` / `<ol>` (`useReorder` finds the rows in it). */
  listRef?: Ref<HTMLElement>;
  className?: string;
}

/** A card of rows (docs/SPEC.md §4 "Shared components"): Settings lists, stashes. */
export function List({
  items,
  label,
  density = 'regular',
  radius = 12,
  width,
  heading,
  collapsed,
  onToggle,
  empty,
  addLabel,
  onAdd,
  adding,
  ordered,
  listRef,
  className,
}: ListProps) {
  const [ownCollapsed, setOwnCollapsed] = useState(!!collapsed);
  const shut = onToggle ? !!collapsed : ownCollapsed;
  const compact = density === 'compact';
  const Tag = ordered ? 'ol' : 'ul';
  const card = [styles.card, radius === 10 && styles.r10].filter(Boolean).join(' ');

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')} style={width != null ? { width } : undefined}>
      {heading && (
        <button
          type="button"
          className={styles.heading}
          aria-expanded={!shut}
          onClick={() => (onToggle ? onToggle() : setOwnCollapsed(!shut))}
        >
          <span className={shut ? `${styles.chevron} ${styles.chevronShut}` : styles.chevron}>
            <Icon name="chevron-down" size={12} />
          </span>
          <span className={styles.headingLabel}>{heading}</span>
          <span className={styles.count}>{items.length}</span>
        </button>
      )}
      {!shut && (
        <div className={card}>
          {(items.length > 0 || empty == null) && (
            <Tag ref={listRef as Ref<HTMLOListElement & HTMLUListElement>} aria-label={label ?? heading} className={styles.list}>
              {items.map(({ key, rowProps, ...row }) => (
                <li key={key} {...rowProps} className={[styles.item, rowProps?.className].filter(Boolean).join(' ')}>
                  <ListRow {...row} density={density} />
                </li>
              ))}
            </Tag>
          )}
          {items.length === 0 && empty != null && (
            <div className={compact ? `${styles.empty} ${styles.emptyCompact}` : styles.empty}>{empty}</div>
          )}
          {adding ? (
            <div className={items.length > 0 ? `${styles.addField} ${styles.ruled}` : styles.addField}>
              <Input size={28} mono {...adding} />
            </div>
          ) : (
            addLabel && (
              <div className={[styles.add, compact && styles.addCompact, items.length > 0 && styles.ruled].filter(Boolean).join(' ')}>
                <Button variant="link" onClick={onAdd}>
                  {addLabel}
                </Button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

/** One row of a `List`, drawn from data (`ListRow.dc.html`). */
export function ListRow({
  handle,
  lead = 'none',
  leadText,
  icon = 'package',
  prefix,
  title,
  titleMono,
  titleWeight = 400,
  titleWidth,
  badges,
  detail,
  sub,
  aside,
  asideTone = 'muted',
  actions,
  actionsOnHover,
  active,
  off,
  density = 'regular',
}: ListRowProps) {
  const compact = density === 'compact';
  const row = [styles.row, compact ? styles.compact : styles.regular, active && styles.active, actionsOnHover && styles.hoverActions]
    .filter(Boolean)
    .join(' ');
  const titleCls = [
    styles.title,
    titleMono && styles.titleMono,
    titleWeight === 500 && styles.titleStrong,
    titleWidth && styles.titleFixed,
    off && styles.titleOff,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={row}>
      {handle && <DragHandle {...handle} />}
      {lead === 'index' && <span className={styles.index}>{leadText}</span>}
      {lead === 'icon' && (
        <span className={styles.icon} aria-hidden>
          <Icon name={icon} size={14} strokeWidth={1.6} />
        </span>
      )}
      {lead === 'tile' && (
        <IconTile name={icon} className={off ? styles.tileOff : undefined} />
      )}
      <span className={styles.body}>
        <span className={styles.line}>
          {prefix && <span className={styles.prefix}>{prefix}</span>}
          <span className={titleCls} title={title} style={titleWidth ? { width: titleWidth } : undefined}>
            {title}
          </span>
          {badges?.map((b) => (
            <Pill key={b.label} tone={b.tone} size="sm" mono={b.mono}>
              {b.label}
            </Pill>
          ))}
          {detail && (
            <span className={styles.detail} title={detail}>
              {detail}
            </span>
          )}
        </span>
        {sub && sub.length > 0 && (
          <span className={styles.sub}>
            {sub.map((part, i) => [
              i > 0 && (
                <span key={`dot${i}`} className={styles.dot}>
                  ·
                </span>
              ),
              'pill' in part ? (
                <Pill key={i} tone={part.tone ?? 'neutral'} size="sm" mono>
                  {part.pill}
                </Pill>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            ])}
          </span>
        )}
      </span>
      {aside && <span className={`${styles.aside} ${styles[asideTone]}`}>{aside}</span>}
      {actions && actions.length > 0 && (
        <span className={styles.actions}>
          {actions.map((a, i) => (
            <RowAction key={i} action={a} size={compact ? 24 : 28} />
          ))}
        </span>
      )}
    </div>
  );
}

function RowAction({ action: a, size }: { action: ListAction; size: 24 | 28 }) {
  switch (a.kind) {
    case 'element':
      return <>{a.element}</>;
    case 'pill':
      return (
        <Pill tone={a.tone} title={a.title}>
          {a.label}
        </Pill>
      );
    case 'switch':
      return (
        <span className={styles.switch}>
          <Switch
            checked={a.checked}
            disabled={a.disabled}
            aria-label={a.ariaLabel}
            title={a.title}
            onChange={(e) => a.onToggle(e.target.checked)}
          />
        </span>
      );
    default: {
      const variant = a.variant ?? 'ghost';
      if (a.icon && !a.label && variant === 'ghost')
        return (
          <IconButton
            size={size}
            active={a.active}
            disabled={a.disabled}
            aria-label={a.ariaLabel}
            title={a.title}
            onClick={a.onPress}
          >
            <Icon name={a.icon} size={13} />
          </IconButton>
        );
      return (
        <Button
          variant={variant}
          size={size}
          icon={a.icon}
          active={a.active}
          disabled={a.disabled}
          aria-label={a.label ? undefined : a.ariaLabel}
          title={a.title}
          onClick={a.onPress}
        >
          {a.label}
        </Button>
      );
    }
  }
}
