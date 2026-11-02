import { useRef, useState } from "react";
import { MochiBubbleMeta } from "./MochiBubbleMeta";
import { MochiMessageLayout } from "./MochiMessageLayout";
import { MochiWidgetMessageBubble } from "./MochiWidgetMessageBubble";
import { useMochiHistoryWindow } from "../../../hooks/use-mochi-history-window";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMochiOsSettings } from "../../../hooks/use-mochi-os-settings";
import { useConversationCustomStickers } from "../../../hooks/use-conversation-custom-stickers";
import { getMochiCharacterColor } from "./mochi-character-color";
import { DEFAULT_MOCHI_OS_SETTINGS } from "@marinara-engine/shared";
import { fmtMsgTime, isMochiTransferType, type ParsedMochiChatWidget } from "./mochi-os.utils";
import { buildMochiCustomTokens } from "./mochi-os.color";
import { useMochiThemeMode } from "./use-mochi-theme-mode";
import "./mochi-os.css";
import "./mochi-private-chat-widget.css";
import "./mochi-group-chat-widget.css";

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

export function MochiGroupChatWidget({ data }: { data: ParsedMochiChatWidget }) {
  const { t } = useTranslation();
  const { data: settings = DEFAULT_MOCHI_OS_SETTINGS } = useMochiOsSettings();
  const { map: stickerMap } = useConversationCustomStickers();
  const [open, setOpen] = useState(false);

  const groupName = data.chat.name?.trim() || data.chat.target?.trim() || "Group";
  const threadRef = useRef<HTMLDivElement | null>(null);
  const historyWindow = useMochiHistoryWindow(groupName, data.chat.messages.length, threadRef);
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
            <div ref={threadRef} className="mochi-private-thread" aria-label={t("ui.chat.mochiPrivateChat.messages")}>
              {data.chat.date && <div className="mochi-private-day">{data.chat.date}</div>}
              {historyWindow.startIndex > 0 && <button type="button" className="notice mochi-history-more" onClick={historyWindow.showOlder}>
                {t("ui.chat.mochiosview.loadOlderMessages", "Load older messages")}
              </button>}
              {data.chat.messages.slice(historyWindow.startIndex).map((message, visibleIndex) => {
                const index = historyWindow.startIndex + visibleIndex;
                const sender = message.me ? undefined : message.sender?.trim();
                const senderColor = sender ? getMochiCharacterColor(sender) : undefined;
                return (
                  <MochiMessageLayout
                    key={`${message.id || "message"}:${index}`}
                    embedded
                    outgoing={Boolean(message.me)}
                    name={sender || groupName}
                    sender={sender}
                    color={senderColor || getMochiCharacterColor(groupName)}
                    data-message-type={message.type}
                    contentClassName={`${message.type === "sticker" ? "is-sticker" : ""}${isMochiTransferType(message.type) ? " is-transfer" : ""}`}
                  >
                    <MochiWidgetMessageBubble message={message} currency={settings.currency} stickerMap={stickerMap} />
                    {(message.time || data.chat.time) && (
                      <MochiBubbleMeta embedded time={fmtMsgTime(message.time || data.chat.time, settings.timeFormat === "12h")} />
                    )}
                  </MochiMessageLayout>
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
