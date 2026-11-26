import type { ReactNode } from "react";

export type IconName =
  | "home"
  | "list"
  | "layers"
  | "settings"
  | "download"
  | "file"
  | "plus"
  | "pencil"
  | "trash"
  | "check"
  | "alert"
  | "close"
  | "search"
  | "logout"
  | "calendar"
  | "wallet"
  | "tag"
  | "target"
  | "shield"
  | "income"
  | "expense"
  | "refresh";

const PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="m3 10.5 9-7.5 9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12.5 9 5 9-5" />
      <path d="m3 16.5 9 5 9-5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h8M16 7h4M4 17h4M12 17h8" />
      <circle cx="14" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M4 17v3h16v-3" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h4" />
      <path d="M9 13h6M9 17h6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  pencil: (
    <>
      <path d="m4 20 4-.8L19 8.2 15.8 5 5 15.8 4 20Z" />
      <path d="m13.8 7 3.2 3.2" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  check: <path d="m5 12 4.5 4.5L19 7" />,
  alert: (
    <>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v5M12 17.4v.2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 5 5" />
    </>
  ),
  logout: (
    <>
      <path d="M14 5h5v14h-5" />
      <path d="m10 8-4 4 4 4" />
      <path d="M6 12h9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M3 10h18M16 15h2" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12V4h8l10 10-8 8L3 12Z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v6c0 4.5 2.8 7.7 7 9 4.2-1.3 7-4.5 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  income: (
    <>
      <path d="M5 19 19 5" />
      <path d="M9 5h10v10" />
    </>
  ),
  expense: (
    <>
      <path d="M5 5 19 19" />
      <path d="M19 9v10H9" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M19 12a7 7 0 1 1-2-5" />
    </>
  ),
};

export default function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
