/** A four-point sparkle, the motif scattered round the logo, stickers and quotes. */
export function Star({
  size,
  color,
  className,
}: {
  readonly size: number;
  readonly color: string;
  readonly className?: string;
}) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" className={className}>
      <path
        d="M12 0 Q 13.6 10.4 24 12 Q 13.6 13.6 12 24 Q 10.4 13.6 0 12 Q 10.4 10.4 12 0 Z"
        fill={color}
      />
    </svg>
  );
}
