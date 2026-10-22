interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function IconSearch({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8.6" cy="8.6" r="5.1" />
      <path d="M12.4 12.4 16 16" />
    </svg>
  );
}

export function IconInbox({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.2 11.2 5 4.4h10l1.8 6.8v4.2H3.2z" />
      <path d="M3.2 11.2h3.6l.9 1.8h4.6l.9-1.8h3.6" />
    </svg>
  );
}

export function IconClock({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="10" cy="10" r="6.6" />
      <path d="M10 6.4V10l2.6 1.6" />
    </svg>
  );
}

export function IconStar({ size = 16, className, filled }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(size)} className={className} fill={filled ? "currentColor" : "none"}>
      <path d="M10 3.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7L10 13.9l-4.2 2.3.8-4.7L3.2 8.2l4.7-.7z" />
    </svg>
  );
}

export function IconCollection({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.2 6.2h5l1.4 1.7h7.2v8.1H3.2z" />
      <path d="M3.2 6.2V4h4.4l1.3 2.2" />
    </svg>
  );
}

export function IconTag({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10.4 3.2H16v5.6l-7 7-5.6-5.6z" />
      <circle cx="13.1" cy="6.2" r="1.1" />
    </svg>
  );
}

export function IconSource({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <ellipse cx="10" cy="5.2" rx="5.8" ry="2.2" />
      <path d="M4.2 5.2v9.6c0 1.2 2.6 2.2 5.8 2.2s5.8-1 5.8-2.2V5.2" />
      <path d="M4.2 10c0 1.2 2.6 2.2 5.8 2.2s5.8-1 5.8-2.2" />
    </svg>
  );
}

export function IconTrash({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 6h12M8 6V4.2h4V6M5.6 6l.7 10h7.4l.7-10" />
      <path d="M8.4 9v4.4M11.6 9v4.4" />
    </svg>
  );
}

export function IconImport({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10 3.4v8.2M6.4 8l3.6 3.6L13.6 8" />
      <path d="M3.6 13.4v3h12.8v-3" />
    </svg>
  );
}

export function IconList({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 5.4h12M4 10h12M4 14.6h12" />
    </svg>
  );
}

export function IconGrid({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3.4" y="3.4" width="5.4" height="5.4" rx="1" />
      <rect x="11.2" y="3.4" width="5.4" height="5.4" rx="1" />
      <rect x="3.4" y="11.2" width="5.4" height="5.4" rx="1" />
      <rect x="11.2" y="11.2" width="5.4" height="5.4" rx="1" />
    </svg>
  );
}

export function IconPanel({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="4" width="14" height="12" rx="1.6" />
      <path d="M12.2 4v12" />
    </svg>
  );
}

export function IconChevron({ size = 16, className, direction = "right" }: IconProps & { direction?: "up" | "down" | "left" | "right" }) {
  const rotate = { right: 0, down: 90, left: 180, up: 270 }[direction];
  return (
    <svg {...base(size)} className={className} style={{ transform: `rotate(${rotate}deg)` }}>
      <path d="M8 4.8 13.2 10 8 15.2" />
    </svg>
  );
}

export function IconClose({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5.4 5.4l9.2 9.2M14.6 5.4l-9.2 9.2" />
    </svg>
  );
}

export function IconFolderOpen({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 15.4V6h5l1.4 1.7H17l-2 7.7z" />
      <path d="M3 6V4.2h4.4L8.6 6" />
    </svg>
  );
}

export function IconRead({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10 5.2C8.4 4.2 6.3 3.9 3.6 4.2v10.6c2.7-.3 4.8 0 6.4 1 1.6-1 3.7-1.3 6.4-1V4.2c-2.7-.3-4.8 0-6.4 1z" />
      <path d="M10 5.2v10.6" />
    </svg>
  );
}

export function IconCheck({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.4 10.4 8 14l7.6-8" />
    </svg>
  );
}

export function IconRestore({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.6 8.2A6 6 0 1 1 4.3 12" />
      <path d="M3.4 4.2v4.4h4.4" />
    </svg>
  );
}
