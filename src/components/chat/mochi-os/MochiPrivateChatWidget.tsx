import { useRef, useState } from "react";
import { MochiBubbleMeta } from "./MochiBubbleMeta";
import { MochiMessageLayout } from "./MochiMessageLayout";
import { MochiWidgetMessageBubble } from "./MochiWidgetMessageBubble";
import { useMochiHistoryWindow } from "../../../hooks/use-mochi-history-window";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMochiOsSettings } from "../../../hooks/use-mochi-os-settings";
import { useConversationCustomStickers } from "../../../hooks/use-conversation-custom-stickers";
import { useMochiOSPhoneData } from "../../../hooks/use-mochios-data";
import { useChatStore } from "../../../stores/chat.store";
import { getMochiCharacterColor } from "./mochi-character-color";
import { DEFAULT_MOCHI_OS_SETTINGS, type MochiOsCharacterData } from "@mochi-os/shared";
import {
  fmtMsgTime,
  mochiSocialHandle,
  isMochiTransferType,
  type ParsedMochiPrivateChatWidget,
} from "./mochi-os.utils";
import { buildMochiCustomTokens } from "./mochi-os.color";
import { useMochiThemeMode } from "./use-mochi-theme-mode";
import "./mochi-os.css";
import "./mochi-private-chat-widget.css";

export function MochiPrivateChatWidget({ data }: { data: ParsedMochiPrivateChatWidget }) {
  const { t } = useTranslation();
  const { data: settings = DEFAULT_MOCHI_OS_SETTINGS } = useMochiOsSettings();
  const { map: stickerMap } = useConversationCustomStickers();
  const activeChatId = useChatStore((s) => s.activeChatId);
  const { data: phoneDataRes } = useMochiOSPhoneData(activeChatId);
  const [open, setOpen] = useState(false);
  // New private output needs only target=. Display aliases are read from the
  // phone document; legacy record aliases remain a fallback for old transcripts.
  const rawTargetName =
    data.chat.target?.trim() || data.chat.contactname?.trim() || data.chat.name?.trim() || "Character";
  const threadRef = useRef<HTMLDivElement | null>(null);
  const historyWindow = useMochiHistoryWindow(`${activeChatId}:${rawTargetName}`, data.chat.messages.length, threadRef);

  // Check phone_data to see if there is a contact name configured for this character.
  // Both names the record carries are candidates: `target=` is the character's real
  // name, `contactname` is what the user renamed the contact to.
  const recordNames = [data.chat.contactname, data.chat.name, data.chat.target]
    .map((value) => (value || "").trim().toLowerCase())
    .filter(Boolean);
  const characters: MochiOsCharacterData[] = [
    ...(phoneDataRes?.phoneData?.characters || []),
    ...(phoneDataRes?.phoneData?.private_contacts || []),
  ];
  const matchedChar = characters.find((c) => {
    if (!c) return false;
    const keys = [c.id, c.name, c.contactname, mochiSocialHandle(c), c.nickname].map((value) => (value || "").trim().toLowerCase());
    return recordNames.some((recordName) => keys.includes(recordName));
  });
  const name = matchedChar?.contactname?.trim() || data.chat.contactname?.trim() || data.chat.name?.trim() || rawTargetName;
  const initial = Array.from(name)[0]?.toUpperCase() || "C";
  const contactColor = getMochiCharacterColor(matchedChar?.name || rawTargetName);
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
      className={`mochi-scope mochi-private-widget${open ? " is-open" : ""} theme-${settings.theme}${settings.colorPreset ? ` color-${settings.colorPreset}` : ""}`}
      data-mochi-theme={themeMode}
      style={(settings.colorPreset === "custom" ? customThemeTokens : null) as React.CSSProperties}
      aria-label={t("ui.chat.mochiPrivateChat.widgetLabel", { name })}
    >
      {!open ? (
        <div className="mochi-private-contact-screen">
          <button
            type="button"
            className="mochi-private-contact-open"
            aria-label={t("ui.chat.mochiPrivateChat.openChat", { name })}
            onClick={() => setOpen(true)}
          >
            <span
              className="mochi-private-avatar"
              style={{ "--c": contactColor } as React.CSSProperties}
              aria-hidden="true"
            >
              {initial}
            </span>
            <span className="mochi-private-contact-name">{name}</span>
            <span className="mochi-private-contact-hint">{t("ui.chat.mochiPrivateChat.privateChat")}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="mochi-private-chat-view" key="chat">
          <header className="mochi-private-appbar">
            <button
              type="button"
              className="mochi-private-back"
              aria-label={t("ui.chat.mochiPrivateChat.backToContact")}
              onClick={() => setOpen(false)}
            >
              <ArrowLeft size={19} aria-hidden="true" />
            </button>
            <span
              className="mochi-private-avatar is-small"
              style={{ "--c": contactColor } as React.CSSProperties}
              aria-hidden="true"
            >
              {initial}
            </span>
            <strong>{name}</strong>
          </header>
          <div className="mochi-private-chat-content">
            <div ref={threadRef} className="mochi-private-thread" aria-label={t("ui.chat.mochiPrivateChat.messages")}>
              {data.chat.date && <div className="mochi-private-day">{data.chat.date}</div>}
              {historyWindow.startIndex > 0 && <button type="button" className="notice mochi-history-more" onClick={historyWindow.showOlder}>
                {t("ui.chat.mochiosview.loadOlderMessages", "Load older messages")}
              </button>}
              {data.chat.messages.slice(historyWindow.startIndex).map((message, visibleIndex) => (
                <MochiMessageLayout
                  key={`${message.id || "message"}:${historyWindow.startIndex + visibleIndex}`}
                  embedded
                  outgoing={Boolean(message.me)}
                  name={name}
                  color={contactColor}
                  data-message-type={message.type}
                  contentClassName={`${message.type === "sticker" ? "is-sticker" : ""}${
                    isMochiTransferType(message.type) ? " is-transfer" : ""
                  }`}
                >
                  <MochiWidgetMessageBubble message={message} currency={settings.currency} stickerMap={stickerMap} />
                  {(message.time || data.chat.time) && (
                    <MochiBubbleMeta embedded time={fmtMsgTime(message.time || data.chat.time, settings.timeFormat === "12h")} />
                  )}
                </MochiMessageLayout>
              ))}
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
