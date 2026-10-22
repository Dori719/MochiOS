import { Fragment, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMochiOsSettings } from "../../../hooks/use-mochi-os-settings";
import { useConversationCustomStickers } from "../../../hooks/use-conversation-custom-stickers";
import { stickerName } from "../../../st/stickers";
import { useMochiOSPhoneData } from "../../../hooks/use-mochios-data";
import { useChatStore } from "../../../stores/chat.store";
import { getMochiCharacterColor } from "./mochi-character-color";
import { DEFAULT_MOCHI_OS_SETTINGS, type MochiOsCharacterData } from "@marinara-engine/shared";
import {
  parseMochiPrivateChatContent,
  formatMochiTransferDisplay,
  isMochiTransferType,
  mochiTransferNote,
  mochiTransferOutcome,
  type ParsedMochiPrivateChatWidget,
} from "./mochi-os.utils";
import { buildMochiCustomTokens } from "./mochi-os.color";
import { useMochiThemeMode } from "./use-mochi-theme-mode";
import "./mochi-os.css";
import "./mochi-private-chat-widget.css";

export function renderMochiPrivateChatBlocks(text: string, renderText: (text: string) => ReactNode): ReactNode | null {
  const parts = parseMochiPrivateChatContent(text);
  if (!parts.length) return null;
  return parts.map((part, index) =>
    part.type === "text" ? (
      <Fragment key={`text-${index}`}>{renderText(part.value)}</Fragment>
    ) : (
      <MochiPrivateChatWidget key={`widget-${index}`} data={part.value} />
    ),
  );
}

function getStickerName(text: string): string {
  return stickerName(text);
}

/**
 * A money-transfer card: `t: transfer`, or the `t: transfer-accepted` /
 * `t: transfer-rejected` item that settles it. The widget is read-only, so it
 * renders the outcome but offers no Accept / Reject buttons — answering happens
 * in the Mochi OS chat itself.
 */
function MochiPrivateTransferCard({
  item,
  isUser,
  currency,
}: {
  item: { type?: string; rawItem?: Record<string, any> };
  isUser: boolean;
  currency: string;
}) {
  const { t } = useTranslation();
  const amount = formatMochiTransferDisplay(item.rawItem, currency);
  const note = mochiTransferNote(item.rawItem);
  const outcome = mochiTransferOutcome(item.type);

  const stampLabel = outcome
    ? outcome === "accepted"
      ? t("ui.chat.mochiPrivateChat.transferAccepted")
      : t("ui.chat.mochiPrivateChat.transferRejected")
    : "";

  return (
    <div className={`mochi-private-transfer${outcome ? ` is-${outcome}` : ""}`}>
      <div className="mochi-private-transfer-legend">
        <span className="mochi-private-transfer-medallion" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <line x1="12" y1="3" x2="12" y2="21" />
            {isUser ? (
              <>
                <polyline points="6 9 12 3 18 9" />
                <polyline points="6 15 12 21 18 15" />
              </>
            ) : (
              <>
                <polyline points="18 9 12 15 6 9" />
                <polyline points="18 15 12 21 6 15" />
              </>
            )}
          </svg>
        </span>
        <span className="mochi-private-transfer-direction">
          {isUser ? t("ui.chat.mochiPrivateChat.transferSent") : t("ui.chat.mochiPrivateChat.transferReceived")}
        </span>
      </div>
      <div className="mochi-private-transfer-amount">
        {amount || t("ui.chat.mochiPrivateChat.transferAmountUnknown")}
      </div>
      {note && (
        <div className="mochi-private-transfer-memo">
          <span className="mochi-private-transfer-memo-label">{t("ui.chat.mochiPrivateChat.transferMemo")}</span>
          <span className="mochi-private-transfer-memo-text">{note}</span>
        </div>
      )}
      {outcome && (
        <div className="mochi-private-transfer-stamp" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            {outcome === "accepted" ? (
              <polyline points="20 6 9 17 4 12" />
            ) : (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            )}
          </svg>
          <span>{stampLabel}</span>
        </div>
      )}
    </div>
  );
}

function MochiPrivateChatWidget({ data }: { data: ParsedMochiPrivateChatWidget }) {
  const { t } = useTranslation();
  const { data: settings = DEFAULT_MOCHI_OS_SETTINGS } = useMochiOsSettings();
  const { map: stickerMap } = useConversationCustomStickers();
  const activeChatId = useChatStore((s) => s.activeChatId);
  const { data: phoneDataRes } = useMochiOSPhoneData(activeChatId);
  const [open, setOpen] = useState(false);
  // The private record names the contact with `contactname:` (older records still
  // use `name:`), and `target=` holds the character's real name as a last resort.
  const rawTargetName =
    data.chat.contactname?.trim() || data.chat.name?.trim() || data.chat.target?.trim() || "Character";

  // Check phone_data to see if there is a contact name configured for this character.
  // Both names the record carries are candidates: `target=` is the character's real
  // name, `contactname` is what the user renamed the contact to.
  const recordNames = [data.chat.contactname, data.chat.name, data.chat.target]
    .map((value) => (value || "").trim().toLowerCase())
    .filter(Boolean);
  const characters = (phoneDataRes?.phoneData?.characters as MochiOsCharacterData[] | undefined) || [];
  const matchedChar = characters.find((c) => {
    if (!c) return false;
    const keys = [c.id, c.name, c.contactname, c.nickname].map((value) => (value || "").trim().toLowerCase());
    return recordNames.some((recordName) => keys.includes(recordName));
  });
  const name = matchedChar?.contactname?.trim() || rawTargetName;
  const initial = Array.from(name)[0]?.toUpperCase() || "C";
  const contactColor = getMochiCharacterColor(rawTargetName);
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
            <div className="mochi-private-thread" aria-label={t("ui.chat.mochiPrivateChat.messages")}>
              {data.chat.date && <div className="mochi-private-day">{data.chat.date}</div>}
              {data.chat.messages.map((message, index) => (
                <article key={message.id || index} className={`mochi-private-message${message.me ? " is-user" : ""}`}>
                  {!message.me && (
                    <span
                      className="mochi-private-mini-avatar"
                      style={{ "--c": contactColor } as React.CSSProperties}
                      aria-hidden="true"
                    >
                      {initial}
                    </span>
                  )}
                  <div
                    className={`mochi-private-bubble-wrap${message.type === "sticker" ? " is-sticker" : ""}${
                      isMochiTransferType(message.type) ? " is-transfer" : ""
                    }`}
                  >
                    {isMochiTransferType(message.type) ? (
                      <MochiPrivateTransferCard
                        item={message}
                        isUser={Boolean(message.me)}
                        currency={settings.currency}
                      />
                    ) : (
                      <div className={`mochi-private-bubble${message.type === "quote" ? " is-quote" : ""}`}>
                        {message.type === "quote" && message.rawItem?.quote ? (
                          <div className="mochi-private-quoted-message">
                            {(() => {
                              const quote = message.rawItem?.quote;
                              const quoteText =
                                typeof quote === "string" ? quote : String(quote?.c || quote?.content || "");
                              const stickerUrl = stickerMap.get(getStickerName(quoteText));
                              return (
                                <>
                                  {typeof quote === "object" && quote?.name && <strong>{String(quote.name)}</strong>}
                                  {stickerUrl ? (
                                    <img className="mochi-private-sticker" src={stickerUrl} alt="" />
                                  ) : (
                                    <span>{quoteText || "Quote"}</span>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        ) : null}
                        <div>
                          {message.type === "sticker" &&
                           stickerMap.get(getStickerName(message.text)) ? (
                            <img
                              className="mochi-private-sticker"
                              src={stickerMap.get(getStickerName(message.text))}
                              alt={message.text}
                            />
                          ) : (
                            message.text
                          )}
                        </div>
                      </div>
                    )}
                    {(message.time || data.chat.time) && (
                      <time className="mochi-private-time">{message.time || data.chat.time}</time>
                    )}
                  </div>
                </article>
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
