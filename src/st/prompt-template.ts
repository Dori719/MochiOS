/** Keep transcript flags and guide placeholders literal through ST macros.
 * Only the opening `{{` is escaped, so no host macro can match the template. */
const OPEN_BRACE = '«';

export function protectTemplateBraces(text: string): string {
  return text.replace(/\{\{/g, OPEN_BRACE);
}

export function restoreTemplateBraces(text: string): string {
  return text.split(OPEN_BRACE).join('{{');
}
