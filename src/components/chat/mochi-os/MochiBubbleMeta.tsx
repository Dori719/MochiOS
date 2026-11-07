import { CircleCheck } from "lucide-react";

/** Private incoming receipts sit on the same quiet baseline as the timestamp. */
export function MochiBubbleMeta({ time, embedded = false, userRead }: { time: string; embedded?: boolean; userRead?: boolean }) {
  if (embedded) return <time className="mochi-private-time">{time}</time>;
  return <span className={`mochi-bubble-meta${typeof userRead === "boolean" ? " has-receipt" : ""}`}>
    <time className="mt">{time}</time>
    {typeof userRead === "boolean" && <span className={`mochi-read-receipt${userRead ? " is-read" : ""}`} role="img" aria-label={userRead ? "Read by you" : "Unread"} title={userRead ? "Read by you" : "Unread"}>
      <CircleCheck size={14} strokeWidth={2.25} aria-hidden="true" />
      <CircleCheck size={14} strokeWidth={2.25} aria-hidden="true" />
    </span>}
  </span>;
}
