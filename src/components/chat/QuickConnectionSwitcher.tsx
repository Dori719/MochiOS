/**
 * The composer's connection switcher.
 *
 * The engine kept several named model connections per chat and let the user pick
 * one before sending. SillyTavern has a single active connection profile, chosen
 * in its own settings, so there is nothing here to switch — and the Mochi OS view
 * only renders this when it has an explicit chat id, which the port never passes.
 *
 * The component is kept so the view's import and JSX stay untouched.
 */
interface QuickConnectionSwitcherProps {
  chatId: string | null;
  className?: string;
}

export function QuickConnectionSwitcher(_props: QuickConnectionSwitcherProps) {
  // SillyTavern picks the connection profile itself; see the module comment.
  return null;
}
