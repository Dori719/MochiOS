/**
 * `clsx` stand-in.
 *
 * The engine's UI helpers call `cn()` from `lib/utils`, which composes `clsx`
 * with `tailwind-merge`. The port keeps those helpers verbatim, so this module
 * has to answer to the same name. It implements the part `cn` actually uses:
 * conditional class joining.
 */
export type ClassValue =
  | string
  | number
  | bigint
  | null
  | undefined
  | boolean
  | ClassValue[]
  | Record<string, unknown>;

function walk(value: ClassValue, into: string[]): void {
  if (!value) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    into.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item as ClassValue, into);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, on] of Object.entries(value)) {
      if (on) into.push(key);
    }
  }
}

export function clsx(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) walk(input, out);
  return out.join(' ');
}

export default clsx;
