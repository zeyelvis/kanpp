/**
 * The 看片片 mark: two stacked frames (片片) with a play button on the front one (看). The same
 * drawing as app/icon.svg and the PNG icons (public/icon-*.png, app/apple-icon.png).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id="kanpp-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff7a45" />
          <stop offset="1" stopColor="#d0461f" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#kanpp-mark)" />
      <rect x="12" y="15" width="31" height="26" rx="6" fill="#fff" fillOpacity=".38" />
      <rect x="20" y="23" width="32" height="27" rx="6.5" fill="#fff" />
      <path d="M32.5 30.2v12.6c0 .9 1 1.4 1.7.9l9.2-6.3c.6-.4.6-1.3 0-1.7l-9.2-6.3c-.7-.5-1.7 0-1.7.8z" fill="#d0461f" />
    </svg>
  );
}
