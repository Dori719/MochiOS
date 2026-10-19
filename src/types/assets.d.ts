/**
 * Stylesheets are imported as text, not as side effects.
 *
 * The extension injects every stylesheet itself, from `st/styles.ts`, because
 * SillyTavern is one long-lived page: the styles have to arrive with the module
 * and be removed cleanly when the extension is disabled. The build reads `.css`
 * files with esbuild's `text` loader, which turns each one into a module whose
 * default export is its contents.
 */
declare module '*.css' {
  const content: string;
  export default content;
}
