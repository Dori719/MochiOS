/**
 * Dialogs, raised through SillyTavern's popup instead of the engine's React
 * dialog host.
 *
 * The engine rendered its own dialog component and resolved a promise when the
 * user answered. SillyTavern already has a popup, so the port answers the same
 * promise from it: nothing else about a call site changes.
 */
import { ctx, st } from '../st/adapter';

export interface AppDialogOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'destructive' | 'accent';
}

export interface ChoiceOption {
  key: string;
  label: string;
  description?: string;
}

function type(name: 'CONFIRM' | 'INPUT' | 'TEXT'): number {
  const popupTypes = (ctx() as any).POPUP_TYPE as Record<string, number> | undefined;
  const fallback = { CONFIRM: 2, INPUT: 3, TEXT: 1 } as Record<string, number>;
  return Number(popupTypes?.[name] ?? fallback[name]);
}

function affirmative(): number {
  return Number((ctx() as any).POPUP_RESULT?.AFFIRMATIVE ?? 1);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Title plus body, as one popup needs to receive it. */
function body(options: AppDialogOptions): string {
  const title = options.title ? `<h3>${escapeHtml(options.title)}</h3>` : '';
  const message = options.message ? `<p>${escapeHtml(options.message)}</p>` : '';
  return `<div>${title}${message}</div>`;
}

export async function showAlertDialog(options: AppDialogOptions): Promise<void> {
  await st().callGenericPopup(body(options), type('TEXT'), '', {
    okButton: options.confirmLabel || 'OK',
    cancelButton: false,
  });
}

export async function showConfirmDialog(options: AppDialogOptions): Promise<boolean> {
  const result = await st().callGenericPopup(body(options), type('CONFIRM'), '', {
    okButton: options.confirmLabel || 'Confirm',
    cancelButton: options.cancelLabel || 'Cancel',
  });
  return Number(result) === affirmative();
}

export function confirmNonEmptyFolderDelete(itemCount: number, options: AppDialogOptions): Promise<boolean> {
  if (itemCount <= 0) return Promise.resolve(true);
  return showConfirmDialog(options);
}

export async function showPromptDialog(
  options: AppDialogOptions & { initialValue?: string; placeholder?: string },
): Promise<string | null> {
  const result = await st().callGenericPopup(body(options), type('INPUT'), options.initialValue ?? '', {
    okButton: options.confirmLabel || 'Confirm',
    cancelButton: options.cancelLabel || 'Cancel',
  });
  if (typeof result !== 'string') return null;
  return result;
}

/**
 * A stacked-button choice.
 *
 * SillyTavern's popup has no button-per-answer form, so the port shows the
 * options and asks for the number of the one to take. Nothing in Mochi OS calls
 * this today; it exists so a caller would not have to be rewritten.
 */
export async function showChoiceDialog(
  options: AppDialogOptions & { options: ChoiceOption[] },
): Promise<string | null> {
  const lines = options.options
    .map((option, index) => `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`)
    .join('\n');
  const answer = await st().callGenericPopup(
    `${body(options)}<pre>${escapeHtml(lines)}</pre>`,
    type('INPUT'),
    '',
    { okButton: 'Choose', cancelButton: options.cancelLabel || 'Cancel' },
  );
  if (typeof answer !== 'string') return null;
  const index = Number(answer.trim()) - 1;
  return options.options[index]?.key ?? null;
}

export function dismissActiveDialog(): void {
  // SillyTavern owns its popup's lifetime; there is no port-side dialog to close.
}

export function resolveActiveDialog(): void {
  // Nothing to resolve: each dialog's promise settles from SillyTavern's popup.
}
