import { Fragment, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "../compat/i18n";
import { useMochiOsSettings } from "../core/settings";
import { useConversationCustomStickers } from "../core/settings";
import { getMochiCharacterColor } from "./character-color";
import { DEFAULT_MOCHI_OS_SETTINGS } from "./schema";
import { parseMochiGroupChatContent, type ParsedMochiChatWidget } from "./utils";
import { buildMochiCustomTokens } from "./color";
import { useMochiThemeMode } from "./use-theme-mode";
// Stylesheets are aggregated as text and injected into the extension's Shadow
// Root by src/ui/styles.ts; see the note in PrivateChatWidget.tsx.

/**
 * Render the group-chat records embedded in a roleplay message.
 *
 * A roleplay turn can carry a group's transcript inside it, exactly as it can
 * carry one contact's. Both readers return text and widgets, so the surrounding
 * prose survives either way.
 */
export function renderMochiGroupChatBlocks(text: string, renderText: (text: string) => ReactNode): ReactNode | null {
  const parts = parseMochiGroupChatContent(text);
  if (!parts.length) return null;
  return parts.map((part, index) =>
    part.type === "text" ? (
      <Fragment key={`text-${index}`}>{renderText(part.value)}</Fragment>
    ) : (
      <MochiGroupChatWidget key={`widget-${index}`} data={part.value} />
    ),
  );
}

/**
 * The port's entry point: render one group thread straight from its archive.
 *
 * The engine only ever embedded this widget inside a roleplay message; the
 * phone's Messages app needs to render a thread as a whole screen, and reusing
 * the ported renderer keeps one implementation of the group bubbles.
 */
export function MochiGroupChatThread({ data, defaultOpen = true }: { data: ParsedMochiChatWidget; defaultOpen?: boolean }) {
  return <MochiGroupChatWidget data={data} defaultOpen={defaultOpen} />;
}

function stickerNameFromText(text: string): string {
  return text
    .trim()
    .replace(/^\[Sticker\]\s*/i, "")
    .replace(/^sticker:([a-z0-9_]+):$/i, "$1");
}

/**
 * The people who spoke in a group record, in the order they first appear.
 *
 * A group record states how many members it has but not who they are, and the
 * guide allows members to talk to each other, so the thread itself is the only
 * place the roster can come from. Anyone who has not spoken yet is simply not
 * listed, which is why the count shown beside the names is the record's declared
 * `members:` and not the number of names below it.
 */
function threadSenders(messages: Array<{ me?: number; sender?: string }>): string[] {
  const seen: string[] = [];
  for (const message of messages) {
    const name = message.me ? "" : message.sender?.trim();
    if (name && !seen.includes(name)) seen.push(name);
  }
  return seen;
}

function MochiGroupChatWidget({ data, defaultOpen = false }: { data: ParsedMochiChatWidget; defaultOpen?: boolean }) {
  const { t } = useTranslation();
  const { data: settings = DEFAULT_MOCHI_OS_SETTINGS } = useMochiOsSettings();
  const { map: stickerMap } = useConversationCustomStickers();
  // The engine embedded this widget in a roleplay message, so it opened
  // collapsed. Inside the phone's own Messages app the thread is the whole
  // screen, so the port accepts an initial open state — as the private-chat
  // widget does.
  const [open, setOpen] = useState(defaultOpen);

  const groupName = data.chat.name?.trim() || data.chat.target?.trim() || "Group";
  const initial = Array.from(groupName)[0]?.toUpperCase() || "G";
  const senders = threadSenders(data.chat.messages);
  const rgb = settings.customRgb;
  const customColor = `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  // The widget renders inside a chat message, so it has to apply the same
  // derived custom palette the Mochi OS shell uses rather than the raw pick.
  const themeMode = useMochiThemeMode(settings.theme);
  const customThemeTokens = settings.colorPreset === "custom" ? buildMochiCustomTokens(customColor, themeMode) : null;
  const environment = [
    [t("ui.chat.mochiPrivateChat.timezone"), data.environment.timezone],
    [t("ui.chat.mochiPrivateChat.date"), data.environment.date],
    [t("ui.chat.mochiPrivateChat.time"), data.environment.time],
    [t("ui.chat.mochiPrivateChat.location"), data.environment.location],
    [t("ui.chat.mochiPrivateChat.temperature"), data.environment.temperature],
    [t("ui.chat.mochiPrivateChat.weather"), data.environment.weather],
  ].filter((entry): entry is [string, string] => !!entry[1]);

  return (
    <section
      className={`mochi-scope mochi-private-widget mochi-group-widget${open ? " is-open" : ""} theme-${settings.theme}${settings.colorPreset ? ` color-${settings.colorPreset}` : ""}`}
      style={(settings.colorPreset === "custom" ? customThemeTokens : null) as React.CSSProperties}
      aria-label={t("ui.chat.mochiGroupChat.widgetLabel", { name: groupName })}
    >
      {!open ? (
        <div className="mochi-private-contact-screen">
          <button
            type="button"
            className="mochi-private-contact-open"
            aria-label={t("ui.chat.mochiGroupChat.openChat", { name: groupName })}
            onClick={() => setOpen(true)}
          >
            <span
              className="mochi-private-avatar"
              style={{ "--c": getMochiCharacterColor(groupName) } as React.CSSProperties}
              aria-hidden="true"
            >
              {initial}
            </span>
            <span className="mochi-private-contact-name">{groupName}</span>
            <span className="mochi-private-contact-hint">{t("ui.chat.mochiosview.groupChat")}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="mochi-private-chat-view" key="chat">
          <header className="mochi-private-appbar">
            <button
              type="button"
              className="mochi-private-back"
              aria-label={t("ui.chat.mochiGroupChat.backToGroup")}
              onClick={() => setOpen(false)}
            >
              <ArrowLeft size={19} aria-hidden="true" />
            </button>
            <span
              className="mochi-private-avatar is-small"
              style={{ "--c": getMochiCharacterColor(groupName) } as React.CSSProperties}
              aria-hidden="true"
            >
              {initial}
            </span>
            <strong>{groupName}</strong>
            {senders.length > 1 && (
              <span className="mochi-group-avatar-stack" aria-hidden="true">
                {senders.slice(0, 4).map((sender) => (
                  <span
                    key={sender}
                    className="mochi-private-mini-avatar is-tiny"
                    style={{ "--c": getMochiCharacterColor(sender) } as React.CSSProperties}
                  >
                    {Array.from(sender)[0]?.toUpperCase()}
                  </span>
                ))}
              </span>
            )}
          </header>
          <div className="mochi-private-chat-content">
            <div className="mochi-private-thread" aria-label={t("ui.chat.mochiPrivateChat.messages")}>
              {data.chat.date && <div className="mochi-private-day">{data.chat.date}</div>}
              {data.chat.messages.map((message, index) => {
                const sender = message.me ? undefined : message.sender?.trim();
                const senderColor = sender ? getMochiCharacterColor(sender) : undefined;
                return (
                  <article key={message.id || index} className={`mochi-private-message${message.me ? " is-user" : ""}`}>
                    {!message.me && (
                      <span
                        className="mochi-private-mini-avatar"
                        style={{ "--c": senderColor || getMochiCharacterColor(groupName) } as React.CSSProperties}
                        aria-hidden="true"
                      >
                        {sender ? Array.from(sender)[0]?.toUpperCase() : initial}
                      </span>
                    )}
                    <div className={`mochi-private-bubble-wrap${message.type === "sticker" ? " is-sticker" : ""}`}>
                      <div className={`mochi-private-bubble${message.type === "quote" ? " is-quote" : ""}`}>
                        {message.type === "quote" && message.rawItem?.quote ? (
                          <div className="mochi-private-quoted-message">
                            {(() => {
                              const quote = message.rawItem?.quote;
                              const quoteText =
                                typeof quote === "string" ? quote : String(quote?.c || quote?.content || "");
                              const stickerUrl = stickerMap.get(stickerNameFromText(quoteText));
                              return (
                                <>
                                  {typeof quote === "object" && quote?.name && <strong>{String(quote.name)}</strong>}
                                  {stickerUrl ? (
                                    <img className="mochi-private-sticker" src={stickerUrl} alt="" />
                                  ) : (
                                    <span>{quoteText || t("ui.chat.mochiGroupChat.quote")}</span>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        ) : null}
                        <div>
                          {message.type === "sticker" && stickerMap.get(stickerNameFromText(message.text || "")) ? (
                            <img
                              className="mochi-private-sticker"
                              src={stickerMap.get(stickerNameFromText(message.text || ""))}
                              alt={message.text}
                            />
                          ) : (
                            message.text
                          )}
                        </div>
                      </div>
                      {/* A group transcript is unreadable without the author on every
                          bubble. The name goes under the message beside the time, so
                          the thread is not pushed down by a line per bubble. */}
                      {(sender || message.time || data.chat.time) && (
                        <span className="mochi-private-bubble-meta">
                          {sender && (
                            <span className="mochi-msg-sender" style={{ color: senderColor }}>
                              {sender}
                            </span>
                          )}
                          {(message.time || data.chat.time) && (
                            <time className="mochi-private-time">{message.time || data.chat.time}</time>
                          )}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {environment.length > 0 && (
              <aside className="mochi-private-environment" aria-label={t("ui.chat.mochiPrivateChat.environment")}>
                <div className="mochi-private-environment-title">☀ {t("ui.chat.mochiPrivateChat.environment")}</div>
                <dl>
                  {environment.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </aside>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
