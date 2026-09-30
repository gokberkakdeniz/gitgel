// Outline icons copied from the design screens (see docs/SPEC.md §11). No emoji.
import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
  className?: string;
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

export function SidebarIcon({ size = 17, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.6} className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </Svg>
  );
}

export function BackIcon({ size = 17, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.6} className={className}>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </Svg>
  );
}

export function ForwardIcon({ size = 17, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.6} className={className}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Svg>
  );
}

export function PlusIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={2} className={className}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function BranchIcon({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.6} className={className}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
      <path d="M6 8.2v7.6" />
      <path d="M18 11.2c0 3-3 4.3-9.8 5" />
    </Svg>
  );
}

/** The 40px branch drawing of the empty state (thinner stroke, larger nodes). */
export function BranchLargeIcon({ size = 40, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.4} className={className}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7" />
      <path d="M18 11.5c0 3-3 4.5-9.5 5.2" />
    </Svg>
  );
}

export function SearchIcon({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.7} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Svg>
  );
}

/** Sliders; the knobs are filled with the background they sit on (`--icon-knob`). */
export function SlidersIcon({ size = 16, className }: IconProps) {
  const knob = { fill: 'var(--icon-knob, var(--bg-sidebar))' };
  return (
    <Svg size={size} strokeWidth={1.7} className={className}>
      <path d="M8 4v16M16 4v16" />
      <circle cx="8" cy="15" r="2.2" style={knob} />
      <circle cx="16" cy="9" r="2.2" style={knob} />
    </Svg>
  );
}

export function FolderIcon({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.6} className={className}>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    </Svg>
  );
}

export function FolderPlusIcon({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.7} className={className}>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </Svg>
  );
}

export function GearIcon({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.6} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Svg>
  );
}

export function RefreshIcon({ size = 15, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.8} className={className}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </Svg>
  );
}

export function PencilIcon({ size = 15, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.8} className={className}>
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 12, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={2} className={className}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function ChevronUpIcon({ size = 12, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={2} className={className}>
      <path d="m6 15 6-6 6 6" />
    </Svg>
  );
}

/** Diff layouts (Review view menu). */
export function SplitIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.7} className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M12 4.5v15" />
    </Svg>
  );
}

export function UnifiedIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.7} className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M7.5 9.5h9M7.5 14.5h9" />
    </Svg>
  );
}

export function CheckIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={2.2} className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function CloseIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={2} className={className}>
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

// Menu item icons (`Projects.dc.html` entry menus).

export function CopyIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.8} className={className}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Svg>
  );
}

export function HistoryIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.8} className={className}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 8v4l3 2" />
    </Svg>
  );
}

export function RemoveIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.8} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </Svg>
  );
}

/** Stand-in for an app whose icon could not be read. */
export function TerminalIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.8} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </Svg>
  );
}

/** Circle-i; the warning note closing the entry menus' open items. */
export function InfoIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.8} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5v.01" />
    </Svg>
  );
}

/** Arrow up in a circle; the sidebar's update row. */
export function UpdateIcon({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} strokeWidth={1.8} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 11.5 4-4 4 4" />
      <path d="M12 7.5V16.5" />
    </Svg>
  );
}
