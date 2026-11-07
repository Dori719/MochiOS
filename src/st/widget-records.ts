/** Shared by the lazy entry point and renderer; no phone bundle is needed to check a message. */
export const RECORD_HINT = /<(?:privatechat_history|groupchat_history|chat_history|group_message|forum|forum_post|forum_comment)\b/i;

export function mayContainMochiWidget(text: string): boolean {
  return RECORD_HINT.test(text);
}
