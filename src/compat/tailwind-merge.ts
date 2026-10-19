/**
 * `tailwind-merge` stand-in.
 *
 * The ported helpers only need `cn()` to produce a usable class string. Tailwind
 * utility classes do not exist in SillyTavern, so collapsing conflicting
 * utilities would be meaningless — joining is enough, and it keeps the engine's
 * `lib/utils.ts` byte-identical.
 */
export function twMerge(...inputs: Array<string | undefined | null | false>): string {
  return inputs.filter((value): value is string => Boolean(value)).join(' ');
}

export default twMerge;
