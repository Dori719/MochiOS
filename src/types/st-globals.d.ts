/**
 * SillyTavern's own module, imported lazily by `st/adapter.ts`.
 *
 * It is served from the SillyTavern root, not from this extension, so it is not
 * a package and has no types of its own. The shorthand declaration below tells
 * TypeScript to accept the specifier as an untyped module; the adapter restates
 * the small surface it relies on in `StModules`.
 */
declare module '*/st-context.js';
