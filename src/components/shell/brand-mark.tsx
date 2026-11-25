/** Logo mark: a rack seen from the front (3 rooms x 2 floors). One idea, reused on the login and home screens. */
export function BrandMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden>
      <rect width="36" height="36" rx="9" fill="#0a5f73" />
      {[0, 1, 2].flatMap((c) => [0, 1].map((r) => (
        <rect key={`${c}${r}`} x={7 + c * 8.5} y={8 + r * 11} width="6.5" height="9" rx="1.6" fill="#fff" opacity={r === 1 && c === 1 ? 1 : r === 0 ? 0.55 : 0.8} />
      )))}
    </svg>
  );
}
