/** Sender names belong above the content; the footer is always timestamp-only. */
export function MochiBubbleMeta({ time, embedded = false }: { time: string; embedded?: boolean }) {
  if (embedded) return <time className="mochi-private-time">{time}</time>;
  return <span className="mochi-bubble-meta"><time className="mt">{time}</time></span>;
}
