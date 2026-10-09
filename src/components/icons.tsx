// Outline icons copied from the design screens (see docs/SPEC.md §11). No emoji.
import type { ReactNode } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
  /** Overrides the icon's own stroke (e.g. 3 for a checkbox tick). */
  strokeWidth?: number;
}

function Svg({
  size,
  strokeWidth,
  className,
  children,
}: IconProps & { size: number; strokeWidth: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function SidebarIcon({ size = 17, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.6} className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </Svg>
  );
}

export function BackIcon({ size = 17, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.6} className={className}>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </Svg>
  );
}

export function ForwardIcon({ size = 17, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.6} className={className}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Svg>
  );
}

export function PlusIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 2} className={className}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function BranchIcon({ size = 18, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.6} className={className}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
      <path d="M6 8.2v7.6" />
      <path d="M18 11.2c0 3-3 4.3-9.8 5" />
    </Svg>
  );
}

/** The 40px branch drawing of the empty state (thinner stroke, larger nodes). */
export function BranchLargeIcon({ size = 40, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.4} className={className}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7" />
      <path d="M18 11.5c0 3-3 4.5-9.5 5.2" />
    </Svg>
  );
}

export function SearchIcon({ size = 16, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.7} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Svg>
  );
}

/** Sliders; the knobs are filled with the background they sit on (`--icon-knob`). */
export function SlidersIcon({ size = 16, className, strokeWidth: sw }: IconProps) {
  const knob = { fill: 'var(--icon-knob, var(--bg-sidebar))' };
  return (
    <Svg size={size} strokeWidth={sw ?? 1.7} className={className}>
      <path d="M8 4v16M16 4v16" />
      <circle cx="8" cy="15" r="2.2" style={knob} />
      <circle cx="16" cy="9" r="2.2" style={knob} />
    </Svg>
  );
}

export function FolderIcon({ size = 18, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.6} className={className}>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    </Svg>
  );
}

/** A terminal (>_): where a branch is checked out (a worktree), apart from the repo's folder. */
export function WorktreeIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="m8 10 2.5 2.5L8 15M13 15h3" />
    </Svg>
  );
}

export function FolderPlusIcon({ size = 18, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.7} className={className}>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </Svg>
  );
}

export function GearIcon({ size = 18, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.6} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Svg>
  );
}

export function RefreshIcon({ size = 15, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </Svg>
  );
}

export function PencilIcon({ size = 15, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 12, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 2} className={className}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function ChevronUpIcon({ size = 12, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 2} className={className}>
      <path d="m6 15 6-6 6 6" />
    </Svg>
  );
}

/** Diff layouts (Review view menu). */
export function SplitIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.7} className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M12 4.5v15" />
    </Svg>
  );
}

export function UnifiedIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.7} className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M7.5 9.5h9M7.5 14.5h9" />
    </Svg>
  );
}

export function CheckIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 2.2} className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function CloseIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 2} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  );
}

export function MoreIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

/** Vertical ⋮, for the narrow row menu column on Branches. */
export function MoreVerticalIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

// Menu item icons (`Projects.dc.html` entry menus).

export function CopyIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Svg>
  );
}

/** A push pin: a repo pinned to the top of Branches. */
export function PinIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M9 3h6" />
      <path d="M10 3v6l-3 4v1h10v-1l-3-4V3" />
      <path d="M12 14v7" />
    </Svg>
  );
}

export function HistoryIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 8v4l3 2" />
    </Svg>
  );
}

export function RemoveIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </Svg>
  );
}

/** Stand-in for an app whose icon could not be read. */
export function TerminalIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </Svg>
  );
}

/** Circle-i; the warning note closing the entry menus' open items. */
export function InfoIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5v.01" />
    </Svg>
  );
}

/** Circle-question mark; Settings › Prompts. */
export function HelpIcon({ size = 16, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.7} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.3" />
      <path d="M12 16.6v.01" />
    </Svg>
  );
}

/** Triangle-exclamation; Confirm Discard Changes. */
export function WarningIcon({ size = 16, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.2v.01" />
    </Svg>
  );
}

/** Arrow up in a circle; the sidebar's update row. */
export function UpdateIcon({ size = 16, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 11.5 4-4 4 4" />
      <path d="M12 7.5V16.5" />
    </Svg>
  );
}

/** Settings › General in the settings section list. */
export function TuneIcon({ size = 16, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.7} className={className}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" />
    </Svg>
  );
}

/** Settings › Shortcuts in the settings section list. */
export function KeyboardIcon({ size = 16, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.7} className={className}>
      <path d="M3.5 6.5h17v11h-17ZM7 10h.01M10.5 10h.01M14 10h.01M17 10h.01M8 14h8" />
    </Svg>
  );
}

/** Move up / down in an ordered list (Settings › Default Base). */
export function ArrowUpIcon({ size = 13, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 2} className={className}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Svg>
  );
}

export function ArrowDownIcon({ size = 13, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 2} className={className}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Svg>
  );
}

// Added with the shared icon set (Icon.dc.html / IconsSpec.dc.html).

export function ChevronRightIcon({ size = 12, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 2} className={className}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function ArrowRightIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </Svg>
  );
}

/** A pencil on a line; editing a list row (Settings › Scripts). */
export function EditIcon({ size = 13, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M4 20h4L19 9l-4-4L4 16Z" />
    </Svg>
  );
}

export function TrashIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </Svg>
  );
}

export function UndoIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
    </Svg>
  );
}

export function DownloadIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </Svg>
  );
}

export function UploadIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M12 15V3M7 8l5-5 5 5M5 21h14" />
    </Svg>
  );
}

export function PlayIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M7 5v14l11-7Z" />
    </svg>
  );
}

/** A shell prompt (>_), without the window of the terminal icon. */
export function PromptIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="m5 8 4 4-4 4M12 16h7" />
    </Svg>
  );
}

export function CodeIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
    </Svg>
  );
}

export function PullRequestIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M6 3.5v17M18 20.5V9a3 3 0 0 0-3-3h-4M13 3l-2 3 2 3" />
    </Svg>
  );
}

export function RebaseIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M7 4v12M3 12l4 4 4-4M17 20V8M13 12l4-4 4 4" />
    </Svg>
  );
}

export function TestIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10" />
    </Svg>
  );
}

export function LinkIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Svg>
  );
}

export function PackageIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5ZM4 7.5 12 11l8-3.5M12 11v9" />
    </Svg>
  );
}

export function RocketIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M5 15c-1.5 1.5-2 4-2 6 2 0 4.5-.5 6-2M9 13l2 2M14 4c3 0 6 3 6 6l-7 7-6-6Z" />
    </Svg>
  );
}

export function BugIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M9 7a3 3 0 0 1 6 0v1H9ZM7 9h10v5a5 5 0 0 1-10 0ZM4 13h3M17 13h3M5 19l2.5-2M19 19l-2.5-2M12 9v10" />
    </Svg>
  );
}

export function BoltIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 1.8} className={className}>
      <path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z" />
    </Svg>
  );
}

/** An open arc; spin it with an animation in the caller's CSS. */
export function SpinnerIcon({ size = 14, className, strokeWidth: sw }: IconProps) {
  return (
    <Svg size={size} strokeWidth={sw ?? 2.2} className={className}>
      <path d="M21 12a9 9 0 1 1-9-9" />
    </Svg>
  );
}

/** Every icon by its design name (`Icon.dc.html`, the canvas's Icons page). */
const ICONS = {
  sidebar: SidebarIcon,
  back: BackIcon,
  forward: ForwardIcon,
  'chevron-down': ChevronDownIcon,
  'chevron-up': ChevronUpIcon,
  'chevron-right': ChevronRightIcon,
  'arrow-up': ArrowUpIcon,
  'arrow-down': ArrowDownIcon,
  'arrow-right': ArrowRightIcon,
  plus: PlusIcon,
  close: CloseIcon,
  check: CheckIcon,
  search: SearchIcon,
  refresh: RefreshIcon,
  pencil: PencilIcon,
  edit: EditIcon,
  copy: CopyIcon,
  remove: RemoveIcon,
  trash: TrashIcon,
  undo: UndoIcon,
  history: HistoryIcon,
  pin: PinIcon,
  download: DownloadIcon,
  upload: UploadIcon,
  play: PlayIcon,
  more: MoreIcon,
  'more-vertical': MoreVerticalIcon,
  folder: FolderIcon,
  'folder-plus': FolderPlusIcon,
  branch: BranchIcon,
  worktree: WorktreeIcon,
  terminal: TerminalIcon,
  prompt: PromptIcon,
  code: CodeIcon,
  'pull-request': PullRequestIcon,
  rebase: RebaseIcon,
  test: TestIcon,
  link: LinkIcon,
  package: PackageIcon,
  rocket: RocketIcon,
  bug: BugIcon,
  bolt: BoltIcon,
  gear: GearIcon,
  sliders: SlidersIcon,
  tune: TuneIcon,
  keyboard: KeyboardIcon,
  split: SplitIcon,
  unified: UnifiedIcon,
  info: InfoIcon,
  help: HelpIcon,
  warning: WarningIcon,
  update: UpdateIcon,
  spinner: SpinnerIcon,
} satisfies Record<string, (props: IconProps) => ReactNode>;

export type IconName = keyof typeof ICONS;

/** A stored name (e.g. an imported script's icon) that is in the set. */
export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/** An icon by name, at its own size and stroke unless given. */
export function Icon({ name, ...props }: IconProps & { name: IconName }) {
  const Glyph = ICONS[name];
  return <Glyph {...props} />;
}
