/**
 * `sonner` stand-in.
 *
 * The engine raises transient notices through `sonner`'s `toast`, including the
 * `toast.loading` handle it later dismisses. The engine mounted a `<Toaster/>`
 * in its app shell; here the notices surface through SillyTavern's own popup and
 * console, so the API shape is preserved without a second toast stack.
 */
type ToastKind = 'success' | 'error' | 'info' | 'warning' | 'loading';

function emit(kind: ToastKind, message: unknown, description?: unknown): string {
  const text = [message, description]
    .filter((part) => typeof part === 'string' && part)
    .join(' — ');
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (context?.toastr && kind !== 'loading') {
      const map: Record<string, string> = {
        success: 'success',
        error: 'error',
        warning: 'warning',
        info: 'info',
        loading: 'info',
      };
      context.toastr[map[kind]](text);
      return text;
    }
  } catch {
    // SillyTavern is not reachable (tests, first paint); fall through to console.
  }
  if (kind !== 'loading') console.log(`[Mochi OS] ${kind}: ${text}`);
  return text;
}

const make = (kind: ToastKind) => (message?: unknown, description?: unknown) => emit(kind, message, description);

export const toast = Object.assign(
  (message?: unknown, description?: unknown) => emit('info', message, description),
  {
    success: make('success'),
    error: make('error'),
    info: make('info'),
    warning: make('warning'),
    message: make('info'),
    loading: make('loading'),
    custom: make('info'),
    // `toast.loading()` hands back a handle the caller later dismisses. Nothing
    // is stacked here, so the id is accepted and ignored.
    dismiss: (_id?: unknown) => undefined,
    promise: async <T,>(promise: Promise<T>) => promise,
  },
);

/** The engine rendered a `<Toaster/>` in its shell; there is nothing to render. */
export function Toaster() {
  return null;
}

export default toast;
