/** SwaggerBot's bot icon (PRODUCT.md: binding), on a dense-black tile with amber strokes. */
export function BotMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="7" fill="#0e0e0e" />
      <g
        transform="translate(4 4)"
        fill="none"
        stroke="#ffb000"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="9" width="20" height="14" rx="4" />
        <circle cx="12" cy="3" r="2" />
        <path d="M12 5v4m-3 8v-2m6 0v2" />
      </g>
    </svg>
  );
}
