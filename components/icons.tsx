/**
 * A small inline icon set — no dependency, since the app needs perhaps a
 * dozen glyphs total. Directional icons use `rtl:` so they flip with the
 * single `dir="rtl"` on <html> instead of being drawn backwards for a
 * right-to-left reader.
 */

type IconProps = { className?: string }

export function SearchIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m17 17-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function ChevronIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cnRtl(className)}>
      <path
        d="m8 5 5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function cnRtl(className: string) {
  // Points toward reading-start by default (a "back" chevron), and mirrors
  // for rtl automatically via the rtl: variant.
  return `${className} rtl:-scale-x-100`
}

export function MenuIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M3 6h14M3 10h14M3 14h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function XIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="m5 5 10 10M15 5 5 15"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function RefreshIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M16 10a6 6 0 1 1-1.76-4.24M16 4v3.5h-3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ExternalLinkIcon({ className = 'size-3.5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M8 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5V12M11 4h5v5M15.5 4.5 9 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CheckIcon({ className = 'size-3.5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="m5 10 3.5 3.5L15 6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ClockIcon({ className = 'size-3.5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v4l2.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function EyeIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M2 10s2.8-5 8-5 8 5 8 5-2.8 5-8 5-8-5-8-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export function MailIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m3 6 7 5 7-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ScaleIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 3v18M7 21h10M4 7l4-1.5L12 7M20 7l-4-1.5L12 7M2 11l2-4 2 4a2 2 0 1 1-4 0ZM18 11l2-4 2 4a2 2 0 1 1-4 0Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function EyeOffIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M3 3l14 14M8.3 8.4a2.25 2.25 0 0 0 3.15 3.2M6.2 6.1C4 7.4 2 10 2 10s2.8 5 8 5c1.1 0 2.08-.22 2.94-.58M15.6 13.7C17.1 12.6 18 10 18 10s-2.8-5-8-5c-.5 0-.98.04-1.44.12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
