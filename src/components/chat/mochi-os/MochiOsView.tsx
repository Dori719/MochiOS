import React, { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { MochiMessageActions } from "./MochiMessageActions";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { Character, Message, MessageReaction } from "@marinara-engine/shared";
import type {
  MochiTheme,
  MochiColorPreset,
  MochiTimeFormat,
  MochiTempUnit,
  MochiCurrency,
  MochiPresetMode,
  MochiMessage,
  MochiContactsMap,
  MochiMessagesTab,
  MochiSettingsTab,
} from "./mochi-os.types";
import {
  VOICE_WAVE_HEIGHTS,
  TIMEZONES,
  DEFAULT_MOCHI_PRESET,
  DEFAULT_MOCHI_PRESET_JSON,
  MOCHI_MARKER_OPTIONS,
  DEFAULT_FORMAT_GUIDES,
  FORMAT_GUIDE_ITEMS_GENERAL,
  FORMAT_GUIDE_ITEMS_DRAWING_TAGS,
  FORMAT_GUIDE_ITEMS_DRAWING_NATURAL,
  type MochiFormatGuideData,
  type FormatGuideMeta,
} from "./mochi-os.constants";
import {
  two,
  rgbToHex,
  fmtHm,
  fmtTime,
  fmtMsgTime,
  formatRelativeTime,
  wxLabel,
  fmtDur,
  cleanAndExtractRawYaml,
  extractPhoneDataEditorYaml,
  formatFriendInfo,
  formatUserMsgForAi,
  parseChatHistoryBlocks,
  selectMochiThreadContact,
  mergeMochiChatHistoryBlocks,
  reconcileMochiContactHistory,
  parseEnvironmentYaml,
  formatMochiTransferAmount,
  formatMochiTransferDisplay,
  formatMochiTransferMarkerForAi,
  buildMochiContinuationPrompt,
  buildMochiDataGenerationGuideBlock,
  buildMochiGroupContinuationPrompt,
  buildMochiTimeDateWeatherBlock,
  type MochiChatRecordType,
  MOCHI_CURRENCY_CHOICES,
  mochiTransferNote,
  mochiTransferOutcome,
  isMochiTransferType,
  findPendingMochiTransfer,
  locateMochiMessageInRoleplay,
  mochiRoleplayBubbleId,
  resolveMochiRegenerationTurn,
  mochiRegenerationVisibleMessageCount,
  removeMochiThreadMessage,
  MOCHI_TRANSFER_ACCEPTED_TYPE,
  MOCHI_TRANSFER_REJECTED_TYPE,
  mochiMessagePreview,
  mochiSocialHandle,
  normalizeMochiPrivateChatGuide,
  normalizeMochiFormatGuides,
} from "./mochi-os.utils";
import { MascotRabbit1, MascotRabbit2, MochiTabIcon } from "./MochiOsMascots";
import "./mochi-os.css";
import { useTranslation as useUiTranslation } from "react-i18next";
import { useMochiOsSettings, useUpdateMochiOsSettings } from "../../../hooks/use-mochi-os-settings";
import { usePersonas, useCharacters } from "../../../hooks/use-characters";
import {
  useChatMessages,
  useChat,
  useUpdateMochiPersona,
  useBranchChat,
  useUpdateMessage,
  useSetActiveSwipe,
  chatKeys,
} from "../../../hooks/use-chats";
import { getChatCharacterIds, parseCharacterMacroData } from "../../../lib/chat-macros";
import { getChatDisplayName, parseChatMetadata } from "../../../lib/chat-display";
import { usePresets } from "../../../hooks/use-presets";
import { useGenerate } from "../../../hooks/use-generate";
import { useChatStore } from "../../../stores/chat.store";
import { getAvatarCropStyle } from "../../../lib/utils";
import { MessageReactions } from "../MessageReactions";
import { getMochiCharacterColor } from "./mochi-character-color";
import { ReactionAddButton } from "../ReactionAddButton";
import { QuickConnectionSwitcher } from "../QuickConnectionSwitcher";
import { MochiApiSettings } from "./MochiApiSettings";
import { ConversationMediaPickerPanel, type ConversationMediaPickerTabId } from "../ConversationMediaPickerPanel";
import { MochiColorPicker } from "./MochiColorPicker";
import { buildMochiCustomTokens, normalizeHexColor, resolveMochiCustomAccent } from "./mochi-os.color";
import { useMochiThemeMode } from "./use-mochi-theme-mode";
import { normalizeHomescreenAppOrder } from "./mochi-os.apps";
import { getMochiHomeApp } from "./mochi-os.app-icons";
import { SlashCommandFeedback } from "../SlashCommandFeedback";
import { matchSlashCommand, getSlashCompletions, type SlashCommandContext } from "../../../lib/slash-commands";
import { useInstalledCapabilityPackages } from "../../../hooks/use-capability-packages";
import { useConversationCustomStickers } from "../../../hooks/use-conversation-custom-stickers";
import { useMochiMessageActions, type MochiReplyTarget } from "../../../hooks/use-mochi-message-actions";
import { MochiMessageIdentity } from "./MochiMessageIdentity";
import { MochiSettingsSplit } from "./MochiSettingsSplit";
import { stickerName } from "../../../st/stickers";
import { toggleReaction, removeCharacterReaction, reactionTargetOf, USER_REACTOR } from "../../../lib/reactions";
import { api } from "../../../lib/api-client";
import { buildMochiPresetMessages } from "../../../st/preset";
import {
  useMochiOSPhoneData,
  useGenerateMochiOSPhoneData,
  useSaveMochiOSPhoneData,
  useDeleteMochiOSPhoneData,
  type MochiOsCharacterData,
  type MochiOsGroupData,
} from "../../../hooks/use-mochios-data";
import { toast } from "sonner";
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Download,
  Copy,
  Check,
  Pencil,
  Trash2,
  RefreshCw,
  GitBranch,
  CornerUpLeft,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { showConfirmDialog } from "../../../lib/app-dialogs";
import yaml from "yaml";

/** localStorage key holding the user's custom homescreen app order. */
const HOMESCREEN_ORDER_STORAGE_KEY = "mochi_os_app_order";

function MochiStickerName(value: string): string {
  return stickerName(value);
}

/**
 * A money transfer, drawn as the instrument it is: a slip of engraved paper
 * with a denomination medallion, a written amount, and a memo line. When the
 * user answers it, a stamp lands across the face the way one lands on a cheque.
 *
 * The amount and note come from the item's raw fields, never from message text,
 * so a transfer round-trips through the YAML archive as the same slip the sender
 * composed.
 */
function MochiTransferBubble({
  message,
  direction,
  currency,
  pending,
  onAccept,
  onReject,
}: {
  message: MochiMessage;
  direction: "in" | "out";
  currency: string;
  pending: boolean;
  onAccept?: () => void;
  onReject?: () => void;
}) {
  const { t: localizeUi } = useUiTranslation();
  const amount = formatMochiTransferDisplay(message.rawItem, currency);
  const note = mochiTransferNote(message.rawItem);
  const outcome = mochiTransferOutcome(message.type);
  const isOutgoing = direction === "out";

  const stampLabel = outcome
    ? outcome === "accepted"
      ? localizeUi("ui.chat.mochiosview.transferAccepted")
      : localizeUi("ui.chat.mochiosview.transferRejected")
    : "";

  return (
    <div className={`b ${direction} mochi-transfer${outcome ? ` is-${outcome}` : ""}`}>
      {/* Engraved rule with the denomination medallion sitting on it. */}
      <div className="mochi-transfer-legend">
        <span className="mochi-transfer-medallion" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d={isOutgoing ? "M12 19V5" : "M12 5v14"} />
            <polyline points={isOutgoing ? "5 12 12 5 19 12" : "19 12 12 19 5 12"} />
          </svg>
        </span>
        <span className="mochi-transfer-direction">
          {isOutgoing
            ? localizeUi("ui.chat.mochiosview.transferSent")
            : localizeUi("ui.chat.mochiosview.transferReceived")}
        </span>
      </div>

      {/* The amount is the hero. Numeric figures use a serif face: it is the one
          place on this surface that wants to read as engraved currency. */}
      <div className="mochi-transfer-amount">
        <span className="mochi-transfer-figure">{amount}</span>
        {!amount && (
          <span className="mochi-transfer-figure-fallback">
            {localizeUi("ui.chat.mochiosview.transferAmountUnknown")}
          </span>
        )}
      </div>

      {note && (
        <p className="mochi-transfer-memo">
          <span className="mochi-transfer-memo-label">{localizeUi("ui.chat.mochiosview.transferMemo")}</span>
          <span className="mochi-transfer-memo-text">{note}</span>
        </p>
      )}

      {/* Perforation, so the action pair reads as a tear-off stub. */}
      {pending && onAccept && onReject && (
        <div className="mochi-transfer-stub">
          <button type="button" className="mochi-transfer-action is-accept" onClick={onAccept}>
            {localizeUi("ui.chat.mochiosview.transferAccept")}
          </button>
          <button type="button" className="mochi-transfer-action is-reject" onClick={onReject}>
            {localizeUi("ui.chat.mochiosview.transferReject")}
          </button>
        </div>
      )}

      {/* The stamp only exists once the transfer is settled, and sits over the
          paper rather than replacing any content. */}
      {outcome && (
        <div className="mochi-transfer-stamp" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            {outcome === "accepted" ? (
              <>
                <polyline points="20 6 9 17 4 12" />
              </>
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

function MochiTextBubble({
  message,
  direction,
  stickerMap,
}: {
  message: MochiMessage;
  direction: "in" | "out";
  stickerMap: Map<string, string>;
}) {
  const quote = message.type === "quote" ? message.rawItem?.quote : undefined;
  const quotedText =
    typeof quote === "string"
      ? quote
      : quote && typeof quote === "object"
        ? String(quote.c || quote.content || "")
        : "";
  const quotedName = quote && typeof quote === "object" ? String(quote.name || "") : "";
  const stickerUrl = stickerMap.get(MochiStickerName(quotedText));

  if (!quotedText) {
    return <div className={`b ${direction}`}>{message.text}</div>;
  }

  return (
    <div className={`b ${direction} mochi-quote-bubble`}>
      <div className="mochi-quoted-message">
        {quotedName && <strong>{quotedName}</strong>}
        {stickerUrl ? <img className="mochi-chat-sticker-image" src={stickerUrl} alt="" /> : <span>{quotedText}</span>}
      </div>
      <div className="mochi-reply-message">{message.text}</div>
    </div>
  );
}

/**
 * Read a generated group's roster.
 *
 * The AI data prompt writes the roster either as a list or as one comma-separated
 * string, in both snake_case and camelCase, so both shapes are accepted here.
 * That roster is what tells the model which members may speak in a group turn and
 * which avatars the thread draws, so it is resolved once and shared.
 */
export function splitMochiGroupMembers(group?: MochiOsGroupData): { names: string[]; main: string[]; other: string[] } {
  const toList = (raw: unknown): string[] => {
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,，]/) : [];
    return list.map((entry) => String(entry).trim()).filter(Boolean);
  };
  const main = toList(group?.main_members ?? group?.mainMembers);
  const other = toList(group?.other_members ?? group?.otherMembers);
  return { main, other, names: [...main, ...other] };
}

/**
 * A group bubble's author label.
 *
 * A group thread has several counterparts, so an unattributed bubble is
 * unreadable: the transcript has to say who said what. Private chats keep the
 * contact avatar alone because the reader is always that one character.
 */
function MochiGroupSenderLabel({ name }: { name?: string }) {
  const sender = name?.trim();
  if (!sender) return null;
  return (
    <span className="mochi-msg-sender" style={{ color: getMochiCharacterColor(sender) }}>
      {sender}
    </span>
  );
}

/** A catalog entry in the Mochi OS App Store window. */
type AppStoreEntry = {
  id: string;
  name: string;
  category: "social" | "creative" | "utilities" | "games";
  desc: string;
  /** Picks a themed icon wash from CSS so every color preset keeps its own app icons. */
  tone: "blush" | "iris" | "tide" | "ember" | "leaf" | "clay" | "dusk" | "slate";
  icon: ReactNode;
};

/**
 * The App Store catalog. Icons carry a tone instead of a hard-coded gradient so
 * the store reads as part of whichever Mochi OS color preset is active.
 */
const APP_STORE_CATALOG: AppStoreEntry[] = [
  {
    id: "messages",
    name: "Messages",
    category: "social",
    desc: "Direct messages, group roleplay chats & voice notes",
    tone: "blush",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
  {
    id: "forum",
    name: "Forum & Community",
    category: "social",
    desc: "Discussions, roleplay threads and community lore",
    tone: "iris",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: "feed",
    name: "Pulse Feed",
    category: "social",
    desc: "Moments, story updates, and status broadcasts",
    tone: "tide",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    ),
  },
  {
    id: "camera",
    name: "Camera & Vision",
    category: "creative",
    desc: "AI photo snap, mood snapshots and visual memories",
    tone: "ember",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
  },
  {
    id: "music",
    name: "Soundscapes & DJ",
    category: "creative",
    desc: "Background ambient audio, roleplay OSTs & tunes",
    tone: "iris",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
  },
  {
    id: "journal",
    name: "Adventurer's Journal",
    category: "games",
    desc: "Quest logs, character secrets and roleplay notes",
    tone: "leaf",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    id: "maps",
    name: "World Maps",
    category: "games",
    desc: "Interactive exploration points, realms and locations",
    tone: "clay",
    icon: (
      <svg viewBox="0 0 24 24">
        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
        <line x1="8" y1="2" x2="8" y2="18" />
        <line x1="16" y1="6" x2="16" y2="22" />
      </svg>
    ),
  },
  {
    id: "tools",
    name: "Mochi Toolbox",
    category: "utilities",
    desc: "Dice roller, prompt tweaks, calculators and widgets",
    tone: "slate",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a10 10 0 0 0-10 10 10 10 0 0 0 10 10 10 10 0 0 0 10-10 10 10 0 0 0-10-10zm0 4a6 6 0 0 1 6 6" />
      </svg>
    ),
  },
  {
    id: "files",
    name: "File Manager",
    category: "utilities",
    desc: "Lorebook archives, character cards & export bundles",
    tone: "dusk",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

/** Category chips shown above the catalog. Order drives the filter rail. */
const APP_STORE_CATEGORIES: { id: "all" | AppStoreEntry["category"]; label: string; icon: string }[] = [
  { id: "all", label: "All Apps", icon: "✦" },
  { id: "social", label: "Social & Chat", icon: "◍" },
  { id: "creative", label: "Creativity & Art", icon: "◐" },
  { id: "utilities", label: "Utilities", icon: "◈" },
  { id: "games", label: "Games & RP", icon: "◉" },
];

/** The catalog narrowed to the active category chip and search query. */
function filterAppStoreCatalog(
  entries: AppStoreEntry[],
  category: "all" | AppStoreEntry["category"],
  query: string,
): AppStoreEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (category !== "all" && entry.category !== category) return false;
    if (!needle) return true;
    return (
      entry.name.toLowerCase().includes(needle) ||
      entry.desc.toLowerCase().includes(needle) ||
      entry.category.includes(needle)
    );
  });
}

export function MochiOsView({
  chatId: explicitChatId,
}: {
  chatId?: string | null;
} = {}) {
  const { t: localizeUi } = useUiTranslation();
  const storeChatId = useChatStore((s) => s.activeChatId);
  const activeChatId = explicitChatId !== undefined ? explicitChatId : storeChatId;
  const { list: conversationStickers, map: conversationStickerMap } = useConversationCustomStickers();

  const { data: savedPhoneDataResponse } = useMochiOSPhoneData(activeChatId);
  const generatePhoneDataMutation = useGenerateMochiOSPhoneData();
  const savePhoneDataMutation = useSaveMochiOSPhoneData();
  const updateRoleplayMessage = useUpdateMessage(activeChatId ?? null);
  const setActiveSwipe = useSetActiveSwipe(activeChatId ?? null);
  const deletePhoneDataMutation = useDeleteMochiOSPhoneData();
  const branchChat = useBranchChat();
  const branchPendingRef = useRef(false);

  // AI Generated Data Modal State
  const [aiDataModalOpen, setAiDataModalOpen] = useState(false);
  const [aiDataUserRequest, setAiDataUserRequest] = useState("");
  const [aiDataYamlDraft, setAiDataYamlDraft] = useState("");
  /** One erase in flight; a second keystroke must not fire a second delete. */
  const deletingPhoneDataRef = useRef(false);

  // Prepopulate YAML draft when opening modal if we have saved data
  const handleOpenAiDataModal = useCallback(() => {
    // The stored file carries a file header and `<phone_data>` tags for the log
    // and file viewers; the editor edits the document itself, so it opens on the
    // bare YAML.
    if (savedPhoneDataResponse?.rawYaml) {
      setAiDataYamlDraft(extractPhoneDataEditorYaml(savedPhoneDataResponse.rawYaml));
    } else if (savedPhoneDataResponse?.phoneData) {
      setAiDataYamlDraft(yaml.stringify(savedPhoneDataResponse.phoneData));
    }
    setAiDataModalOpen(true);
  }, [savedPhoneDataResponse]);

  const handleCloseAiDataModal = useCallback(() => {
    setAiDataModalOpen(false);
    setAiDataUserRequest("");
  }, []);

  // Validate YAML draft in real-time
  const yamlValidation = useMemo(() => {
    let trimmed = aiDataYamlDraft.trim();
    if (!trimmed) return { isValid: true, error: null };

    // Strip reasoning blocks if present so user/AI can save clean output
    if (trimmed.includes("</think>")) {
      trimmed = trimmed.slice(trimmed.indexOf("</think>") + 8).trim();
    } else if (trimmed.includes("</thinking>")) {
      trimmed = trimmed.slice(trimmed.indexOf("</thinking>") + 11).trim();
    }
    trimmed = trimmed
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .trim();

    // Direct YAML parse on the input (no internal stripping so user sees exact validity of the text)
    let candidate = trimmed;
    // Allow markdown code block stripping if user wrapped the YAML in code fence
    if (candidate.startsWith("```")) {
      candidate = candidate
        .replace(/^```[a-zA-Z0-9_-]*\s*\n/i, "")
        .replace(/\n```\s*$/i, "")
        .trim();
    }

    // Check for stray XML tags that make raw YAML invalid
    if (/<\/?(?:mochios_data|phone_data|mochi_os_data|mochi_data|mochios|data)>/i.test(candidate)) {
      // Strip tag wrapper only if it encapsulates the whole content
      const match =
        candidate.match(/^<mochios_data>([\s\S]*?)<\/mochios_data>$/i) ||
        candidate.match(/^<phone_data>([\s\S]*?)<\/phone_data>$/i) ||
        candidate.match(/^<mochi_os_data>([\s\S]*?)<\/mochi_os_data>$/i) ||
        candidate.match(/^<mochi_data>([\s\S]*?)<\/mochi_data>$/i) ||
        candidate.match(/^<mochios>([\s\S]*?)<\/mochios>$/i) ||
        candidate.match(/^<data>([\s\S]*?)<\/data>$/i);
      if (match && match[1]) {
        candidate = match[1].trim();
      }
    }

    try {
      const parsed = yaml.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { isValid: true, error: null };
      }
      return { isValid: false, error: "YAML must be a valid mapping / object structure (not a scalar or array)" };
    } catch (err: any) {
      return { isValid: false, error: err?.message || "Invalid YAML syntax" };
    }
  }, [aiDataYamlDraft]);

  // People section expanded character ID (for dropdown)
  const [expandedPersonId, setExpandedPersonId] = useState<string | null>(null);
  const peopleListContainerRef = useRef<HTMLDivElement | null>(null);

  // Close people character dropdown when clicked outside
  useEffect(() => {
    if (!expandedPersonId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (peopleListContainerRef.current && !peopleListContainerRef.current.contains(e.target as Node)) {
        setExpandedPersonId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expandedPersonId]);

  // Group profile header dropdown open state (in chat view)
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);

  // Active group chat ID when inside chatView for a group
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  const { data: persistedSettings } = useMochiOsSettings();
  const updateSettingsMutation = useUpdateMochiOsSettings();

  // Personas
  const { data: allPersonas = [] } = usePersonas();
  const { data: activeChatData } = useChat(activeChatId ?? null);
  const updateMochiPersona = useUpdateMochiPersona(activeChatId ?? null);

  // Theme & Appearance State
  const [theme, setTheme] = useState<MochiTheme>(() => persistedSettings?.theme ?? "auto");
  const [colorPreset, setColorPreset] = useState<MochiColorPreset>(() => persistedSettings?.colorPreset ?? "");
  const [customRgb, setCustomRgb] = useState<{ r: number; g: number; b: number }>(
    () => persistedSettings?.customRgb ?? { r: 127, g: 160, b: 97 },
  );
  const [timeFormat, setTimeFormat] = useState<MochiTimeFormat>(() => persistedSettings?.timeFormat ?? "24h");
  const [tempUnit, setTempUnit] = useState<MochiTempUnit>(() => persistedSettings?.tempUnit ?? "C");
  // Transfer amounts are archived as bare numbers; the symbol is display-only.
  const [currency, setCurrency] = useState<MochiCurrency>(() => persistedSettings?.currency ?? "$");

  // Clock state
  const [clockMode, setClockMode] = useState<"tz" | "custom">(() => persistedSettings?.clockMode ?? "tz");
  const [clockTz, setClockTz] = useState<string>(
    () => persistedSettings?.clockTz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [clockOffset, setClockOffset] = useState<number>(() => persistedSettings?.clockOffset ?? 0);
  const [clockAiDecide, setClockAiDecide] = useState<boolean>(() => persistedSettings?.clockAiDecide ?? false);
  const [aiDecidedDate, setAiDecidedDate] = useState<string>(() => (persistedSettings as any)?.aiDecidedDate ?? "");
  const [aiDecidedTime, setAiDecidedTime] = useState<string>(() => (persistedSettings as any)?.aiDecidedTime ?? "");
  const [nowDate, setNowDate] = useState<Date>(() => new Date());

  // Weather state
  const [wxTemp, setWxTemp] = useState<number>(() => persistedSettings?.wxTemp ?? 20);
  const [wxCondition, setWxCondition] = useState<string>(() => persistedSettings?.wxCondition ?? "Sunny");
  const [wxPlace, setWxPlace] = useState<string>(() => persistedSettings?.wxPlace ?? "");
  const [wxAiDecide, setWxAiDecide] = useState<boolean>(() => persistedSettings?.wxAiDecide ?? false);

  // Linked Persona State
  const [personaChoice, setPersonaChoice] = useState<{ chatId: string | null; id: string } | null>(null);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const [personaSearchText, setPersonaSearchText] = useState("");

  // AI Preset State
  const [promptPresetMode, setPromptPresetMode] = useState<MochiPresetMode>(
    () => persistedSettings?.promptPresetMode ?? "default",
  );
  const [selectedEnginePresetId, setSelectedEnginePresetId] = useState<string | null>(
    () => persistedSettings?.selectedEnginePresetId ?? null,
  );
  const [customPresetJsonDraft, setCustomPresetJsonDraft] = useState<string>(
    () => persistedSettings?.customPresetJson || DEFAULT_MOCHI_PRESET_JSON,
  );

  // Format Guides State
  const [formatGuidesCategory, setFormatGuidesCategory] = useState<"general" | "drawing_tags" | "drawing_natural">(
    "general",
  );
  const [formatGuidesSearchQuery, setFormatGuidesSearchQuery] = useState("");
  const [formatGuidesDraft, setFormatGuidesDraft] = useState<MochiFormatGuideData>(() => {
    if (persistedSettings?.formatGuidesJson) {
      try {
        return normalizeMochiFormatGuides(JSON.parse(persistedSettings.formatGuidesJson));
      } catch {
        return DEFAULT_FORMAT_GUIDES;
      }
    }
    return DEFAULT_FORMAT_GUIDES;
  });
  const [expandedGuideKey, setExpandedGuideKey] = useState<string | null>("data");
  const [copiedGuideKey, setCopiedGuideKey] = useState<string | null>(null);

  // Conversation Media Picker & Slash Commands State
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaPickerTab, setMediaPickerTab] = useState<ConversationMediaPickerTabId>("emoji");
  const [slashFeedback, setSlashFeedback] = useState<string | null>(null);
  const [slashCompletions, setSlashCompletions] = useState<any[]>([]);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  const { data: installedCapabilityPackages } = useInstalledCapabilityPackages();
  const availableCapabilityIds = useMemo(() => {
    return new Set<string>((installedCapabilityPackages ?? []).map((p: any) => p.id || p.manifest?.id).filter(Boolean));
  }, [installedCapabilityPackages]);

  // Sync state when persistedSettings loads/updates
  const initialSyncDoneRef = useRef(false);
  useEffect(() => {
    if (!persistedSettings) return;
    if (!initialSyncDoneRef.current) {
      initialSyncDoneRef.current = true;
      setTheme(persistedSettings.theme);
      setColorPreset(persistedSettings.colorPreset);
      setCustomRgb(persistedSettings.customRgb);
      setTimeFormat(persistedSettings.timeFormat);
      setTempUnit(persistedSettings.tempUnit);
      setCurrency(persistedSettings.currency);
      setClockMode(persistedSettings.clockMode);
      setClockTz(persistedSettings.clockTz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      setClockOffset(persistedSettings.clockOffset);
      setClockAiDecide(persistedSettings.clockAiDecide);
      setAiDecidedDate((persistedSettings as any)?.aiDecidedDate ?? "");
      setAiDecidedTime((persistedSettings as any)?.aiDecidedTime ?? "");
      setWxTemp(persistedSettings.wxTemp);
      setWxCondition(persistedSettings.wxCondition);
      setWxPlace(persistedSettings.wxPlace);
      // Without this the toggle stays off until it is clicked, even when the
      // settings already have it on, and `applyEnvironmentUpdate` then skips the
      // weather entirely.
      setWxAiDecide(persistedSettings.wxAiDecide);
      setPromptPresetMode(persistedSettings.promptPresetMode ?? "default");
      setSelectedEnginePresetId(persistedSettings.selectedEnginePresetId ?? null);
      setCustomPresetJsonDraft(persistedSettings.customPresetJson || DEFAULT_MOCHI_PRESET_JSON);
      if (persistedSettings.formatGuidesJson) {
        try {
          setFormatGuidesDraft(normalizeMochiFormatGuides(JSON.parse(persistedSettings.formatGuidesJson)));
        } catch {
          setFormatGuidesDraft(DEFAULT_FORMAT_GUIDES);
        }
      }
    }
  }, [persistedSettings]);

  // Sync customWxTemp input field when tempUnit changes
  useEffect(() => {
    setCustomWxTemp((prev) => {
      const parsed = parseFloat(prev);
      if (isNaN(parsed)) return prev;
      // prev was in the old unit, convert to new unit
      if (tempUnit === "F") {
        // Converting C to F
        return Math.round((parsed * 9) / 5 + 32).toString();
      } else {
        // Converting F to C
        return Math.round(((parsed - 32) * 5) / 9).toString();
      }
    });
  }, [tempUnit]);

  // A new phone follows this roleplay's selected ST persona. A phone-specific
  // choice is saved with this chat, never reused as another chat's initial persona.
  const activeLinkedPersona = useMemo(() => {
    const chatMeta = activeChatData ? parseChatMetadata(activeChatData.metadata) : {};
    const chosenId = personaChoice?.chatId === activeChatId ? personaChoice.id : chatMeta.mochios?.linkedPersonaId;
    return allPersonas.find((persona) => persona.id === chosenId) ||
      allPersonas.find((persona) => persona.id === activeChatData?.personaId) ||
      allPersonas.find((persona) => persona.isActive) || null;
  }, [personaChoice, activeChatId, activeChatData, allPersonas]);

  // Profile Form State (Nickname, User ID, Email, Bio)
  const [profileNicknameDraft, setProfileNicknameDraft] = useState("");
  const [profileUserIdDraft, setProfileUserIdDraft] = useState("");
  const [profileEmailDraft, setProfileEmailDraft] = useState("");
  const [profileBioDraft, setProfileBioDraft] = useState("");
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [editingPersonFields, setEditingPersonFields] = useState<{
    name: string;
    contactname: string;
    socialhandle: string;
    email: string;
    onlineStyle: string;
  }>({ name: "", contactname: "", socialhandle: "", email: "", onlineStyle: "" });

  // The phone's screen name belongs to phone_data, not the ST persona name.
  // Reset missing fields as well so another chat's profile never leaks here.
  useEffect(() => {
    const user = savedPhoneDataResponse?.phoneData?.user;
    setProfileNicknameDraft(user?.nickname ?? activeLinkedPersona?.name ?? activeChatData?.userName ?? "");
    setProfileUserIdDraft(user?.id ?? "");
    setProfileBioDraft(user?.bio ?? "");
    setProfileEmailDraft(user?.email ?? "");
  }, [savedPhoneDataResponse, activeLinkedPersona?.id, activeLinkedPersona?.name, activeChatData?.userName]);

  // Save settings immediately helper
  const saveSettings = useCallback(
    (patch: Partial<Parameters<typeof updateSettingsMutation.mutate>[0]>) => {
      const current = {
        theme,
        colorPreset,
        customRgb,
        timeFormat,
        tempUnit,
        currency,
        clockMode,
        clockTz,
        clockOffset,
        clockAiDecide,
        aiDecidedDate,
        aiDecidedTime,
        wxTemp,
        wxCondition,
        wxPlace,
        wxAiDecide,
        linkedPersonaId: persistedSettings?.linkedPersonaId ?? null,
        connectionProfileId: persistedSettings?.connectionProfileId ?? null,
        homeIndicatorMode: persistedSettings?.homeIndicatorMode ?? "both",
        promptPresetMode,
        selectedEnginePresetId,
        customPresetJson: customPresetJsonDraft,
        formatGuidesJson: JSON.stringify(formatGuidesDraft),
        ...patch,
      };
      updateSettingsMutation.mutate(current);
    },
    [
      theme,
      colorPreset,
      customRgb,
      timeFormat,
      tempUnit,
      currency,
      clockMode,
      clockTz,
      clockOffset,
      clockAiDecide,
      aiDecidedDate,
      aiDecidedTime,
      wxTemp,
      wxCondition,
      wxPlace,
      wxAiDecide,
      persistedSettings?.linkedPersonaId,
      persistedSettings?.connectionProfileId,
      promptPresetMode,
      selectedEnginePresetId,
      customPresetJsonDraft,
      formatGuidesDraft,
      updateSettingsMutation,
    ],
  );
  const [wxResults, setWxResults] = useState<Array<{ name: string; region: string; lat: number; lon: number }>>([]);
  const [wxErr, setWxErr] = useState<string>("");
  const [wxSearching, setWxSearching] = useState<boolean>(false);
  const [wxQuery, setWxQuery] = useState<string>("");
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);
  const [customWxLoc, setCustomWxLoc] = useState<string>("");
  const [customWxTemp, setCustomWxTemp] = useState<string>(() => {
    const initial = tempUnit === "F" ? Math.round((20 * 9) / 5 + 32).toString() : "20";
    return initial;
  });
  const [customWxCondChoice, setCustomWxCondChoice] = useState<string>("Sunny");
  const [customWxCondText, setCustomWxCondText] = useState<string>("");

  // Clock Modal Custom Selection state
  const [calView, setCalView] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [calSel, setCalSel] = useState<Date>(() => new Date());
  const [customHour, setCustomHour] = useState<number>(12);
  const [customMin, setCustomMin] = useState<number>(0);
  const [customAmPm, setCustomAmPm] = useState<"AM" | "PM">("AM");
  const [clockModalTab, setClockModalTab] = useState<"tz" | "custom">("tz");
  const [tempTz, setTempTz] = useState<string>(clockTz);

  // Modals Visibility
  const [clockModalOpen, setClockModalOpen] = useState(false);
  const [wxModalOpen, setWxModalOpen] = useState(false);
  const [wxModalTab, setWxModalTab] = useState<"loc" | "custom">("loc");
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsActiveTab, setSettingsActiveTab] = useState<MochiSettingsTab>("appearance");
  const [imagesModalOpen, setImagesModalOpen] = useState(false);
  const [imagesModalTab, setImagesModalTab] = useState<"upload" | "ai" | "text">("upload");
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [isMochiAiGenerating, setIsMochiAiGenerating] = useState(false);
  const mochiGenerationAbortRef = useRef<AbortController | null>(null);
  const mochiActiveOnFailureRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const mochiActiveOnSettledRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => () => {
    mochiGenerationAbortRef.current?.abort();
    mochiActiveOnFailureRef.current = undefined;
    mochiActiveOnSettledRef.current = undefined;
  }, []);

  // Real Engine Characters Data
  const qc = useQueryClient();
  const { data: realCharacters = [] } = useCharacters();
  const { data: enginePresets = [] } = usePresets();
  const { generate, stop: stopEngineGenerate } = useGenerate();

  // Messages for active selected chat
  // Phone threads are not separate ST chats. Their replies are generated by
  // handleTriggerAiGeneration and archived into activeChatId; enabling the
  // engine's separate-chat branch would also send a duplicate roleplay request.
  const effectiveChatId: string | null = null;
  const { data: chatMessagesData } = useChatMessages(effectiveChatId, 50, !!effectiveChatId);
  // ST already holds the full history locally. A roleplay page boundary must not
  // hide a contact's surviving older turn when its latest record is deleted.
  const { data: activeChatMessagesData } = useChatMessages(activeChatId ?? null, 0, !!activeChatId);
  const realChatMessages = useMemo(() => {
    if (!chatMessagesData?.pages) return [];
    const flattened = [...chatMessagesData.pages].reverse().flat();
    return flattened;
  }, [chatMessagesData]);
  const activeChatRoleplayMessages = useMemo(() => {
    if (!activeChatMessagesData?.pages) return [];
    const flattened = [...activeChatMessagesData.pages].reverse().flat();
    return flattened;
  }, [activeChatMessagesData]);

  // Global Chat Store generation state
  const isStreamingGlobal = useChatStore((s) => s.isStreaming);
  const streamingChatId = useChatStore((s) => s.streamingChatId);
  const streamBuffer = useChatStore((s) => s.streamBuffer);
  const isChatGenerating =
    isMochiAiGenerating || (isStreamingGlobal && (streamingChatId === effectiveChatId || !streamingChatId)) || false;

  // Character lookup map
  const characterLookup = useMemo(() => {
    const map = new Map<string, Character>();
    for (const c of realCharacters as unknown as Character[]) {
      if (c && c.id) {
        map.set(c.id, c);
      }
    }
    return map;
  }, [realCharacters]);

  // Resolve primary character name for this roleplay chat
  const primaryRoleplayCharName = useMemo(() => {
    const chatCharIds = getChatCharacterIds(activeChatData);
    const relevantCharacters = (realCharacters as unknown as Character[]).filter((c) => {
      if (!c?.id) return false;
      if (chatCharIds.length > 0) return chatCharIds.includes(c.id);
      return true;
    });
    const target = relevantCharacters[0] || (realCharacters as unknown as Character[])[0];
    if (!target) return "Character";
    const parsed = parseCharacterMacroData(target);
    return parsed?.name || (target.data as any)?.name || target.comment || "Character";
  }, [activeChatData, realCharacters]);

  // Apply reactions to an engine message
  const applyReactionsToMessage = useCallback(
    async (msgId: string, next: MessageReaction[]) => {
      if (!effectiveChatId) return;
      const msgKey = chatKeys.messages(effectiveChatId);
      const previous = qc.getQueryData<InfiniteData<Message[]>>(msgKey);
      qc.setQueryData<InfiniteData<Message[]>>(msgKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) =>
            page.map((m) => {
              if (m.id !== msgId) return m;
              const ex = typeof m.extra === "string" ? JSON.parse(m.extra) : (m.extra ?? {});
              return { ...m, extra: { ...ex, reactions: next } } as Message;
            }),
          ),
        };
      });
      try {
        await api.patch(`/chats/${effectiveChatId}/messages/${msgId}/extra`, { reactions: next });
      } catch (err) {
        qc.setQueryData(msgKey, previous);
        console.error("Failed to update reaction:", err);
      } finally {
        await qc.invalidateQueries({ queryKey: msgKey });
      }
    },
    [effectiveChatId, qc],
  );

  // Resolve reactor display name
  const resolveReactorName = useCallback(
    (reactorId: string) => {
      if (reactorId === USER_REACTOR) return "You";
      const char = characterLookup.get(reactorId);
      if (char) {
        const raw = char.data as Record<string, any> | undefined;
        return raw?.name || "Character";
      }
      return "Someone";
    },
    [characterLookup],
  );

  // Messages App State
  // Messages App State (empty initially for new chats / roleplay sessions)
  const [messagesAppOpen, setMessagesAppOpen] = useState(false);
  const [appStoreOpen, setAppStoreOpen] = useState(false);
  const [appStoreCategory, setAppStoreCategory] = useState<"all" | AppStoreEntry["category"]>("all");
  const [appStoreSearch, setAppStoreSearch] = useState<string>("");
  const [installedApps, setInstalledApps] = useState<Record<string, boolean>>({
    messages: true,
    phone: true,
    mail: true,
    settings: true,
    forum: true,
    feed: true,
    maps: true,
    music: true,
    live: true,
    camera: true,
    calendar: true,
    journal: true,
    tools: true,
    photos: true,
    files: true,
  });
  /** Catalog narrowed by the active category chip and search query. */
  const visibleStoreApps = useMemo(
    () => filterAppStoreCatalog(APP_STORE_CATALOG, appStoreCategory, appStoreSearch),
    [appStoreCategory, appStoreSearch],
  );

  // Homescreen Moveable Apps / Jiggle Mode State
  const [isAppEditingMode, setIsAppEditingMode] = useState(false);
  const [draggingAppIndex, setDraggingAppIndex] = useState<number | null>(null);
  const [dragOverAppIndex, setDragOverAppIndex] = useState<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  /** True when the in-flight press is the one that just opened edit mode. */
  const enteredEditOnThisPressRef = useRef(false);

  const [homescreenAppOrder, setHomescreenAppOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(HOMESCREEN_ORDER_STORAGE_KEY);
      if (saved) {
        return normalizeHomescreenAppOrder(JSON.parse(saved));
      }
    } catch {
      // Corrupt or unavailable storage falls back to the canonical order.
    }
    return normalizeHomescreenAppOrder(null);
  });

  const saveHomescreenAppOrder = useCallback((newOrder: string[]) => {
    const normalized = normalizeHomescreenAppOrder(newOrder);
    setHomescreenAppOrder(normalized);
    try {
      localStorage.setItem(HOMESCREEN_ORDER_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Storage unavailable (private mode / quota); the order still applies in-session.
    }
  }, []);

  /**
   * Long press enters homescreen edit mode, but only a genuine *hold*.
   *
   * A plain timer is not enough: anyone who rests the mouse button a moment
   * longer than the threshold on a normal click would drop into edit mode, and
   * edit mode swallows that very click. So the press must stay still, and the
   * click that ends a press which just entered edit mode is suppressed.
   */
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleAppPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      cancelLongPress();
      // If already editing, holding or clicking does not re-arm or exit edit mode
      if (isAppEditingMode) return;
      longPressStartRef.current = { x: e.clientX, y: e.clientY };
      enteredEditOnThisPressRef.current = false;
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        enteredEditOnThisPressRef.current = true;
        setIsAppEditingMode(true);
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate(40);
        }
      }, 500);
    },
    [cancelLongPress, isAppEditingMode],
  );

  /** Movement past a few pixels cancels long press timer if still pending */
  const handleAppPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const start = longPressStartRef.current;
      if (!start || longPressTimerRef.current === null) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
        cancelLongPress();
      }
    },
    [cancelLongPress],
  );

  const handleAppPointerUpOrLeave = useCallback(() => {
    cancelLongPress();
    longPressStartRef.current = null;
  }, [cancelLongPress]);

  const handleDeleteApp = useCallback((appId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHomescreenAppOrder((prev) => {
      const next = prev.filter((id) => id !== appId);
      try {
        localStorage.setItem(HOMESCREEN_ORDER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const handleAppClick = useCallback(
    (appId: string, e: React.MouseEvent) => {
      // A press that landed on an app is never a wallpaper tap. Without this the
      // click bubbles to the screen and drops out of edit mode, so a long press
      // that never moved would cancel the very mode it entered.
      e.stopPropagation();
      // The press that turned edit mode on must not also launch the app.
      if (enteredEditOnThisPressRef.current) {
        enteredEditOnThisPressRef.current = false;
        return;
      }
      if (isAppEditingMode) {
        return;
      }
      if (appId === "messages") {
        setIsPrivateMode(false);
        setMessagesAppOpen(true);
      }
    },
    [isAppEditingMode],
  );

  const handleAppDragStart = useCallback((index: number, e: React.DragEvent) => {
    setDraggingAppIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${index}`);
  }, []);

  const handleAppDragOver = useCallback(
    (index: number, e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverAppIndex !== index) {
        setDragOverAppIndex(index);
      }
    },
    [dragOverAppIndex],
  );

  const handleAppDrop = useCallback(
    (targetIndex: number, e: React.DragEvent) => {
      e.preventDefault();
      setDragOverAppIndex(null);
      if (draggingAppIndex === null || draggingAppIndex === targetIndex) {
        setDraggingAppIndex(null);
        return;
      }
      const updated = [...homescreenAppOrder];
      const [movedItem] = updated.splice(draggingAppIndex, 1);
      updated.splice(targetIndex, 0, movedItem);
      saveHomescreenAppOrder(updated);
      setDraggingAppIndex(null);
    },
    [draggingAppIndex, homescreenAppOrder, saveHomescreenAppOrder],
  );

  const handleAppDragEnd = useCallback(() => {
    setDraggingAppIndex(null);
    setDragOverAppIndex(null);
  }, []);
  const [inChatView, setInChatView] = useState(false);
  const [isPrivateMode, setIsPrivateMode] = useState(false);
  const [activeTab, setActiveTab] = useState<MochiMessagesTab>("chats");
  const [activeContactId, setActiveContactId] = useState<string>("mochi");
  const [contacts, setContacts] = useState<MochiContactsMap>({});
  const [privateContacts, setPrivateContacts] = useState<MochiContactsMap>({});

  const previousChatIdRef = useRef(activeChatId);
  useEffect(() => {
    if (previousChatIdRef.current === activeChatId) return;
    previousChatIdRef.current = activeChatId;
    setContacts({});
    setPrivateContacts({});
    contactsRef.current = {};
    privateContactsRef.current = {};
  }, [activeChatId]);

  const privateContactsRef = useRef<MochiContactsMap>({});
  useEffect(() => {
    privateContactsRef.current = privateContacts;
  }, [privateContacts]);

  const contactsRef = useRef<MochiContactsMap>({});
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  /**
   * Contacts-map key of the thread on screen.
   *
   * Selecting a group sets both `activeGroupId` (to look up the group record) and
   * `activeContactId` (to `group_<id>`, where its bubbles actually live). Reading
   * `activeGroupId` as the map key wrote group messages under a key nothing reads,
   * so the thread stayed empty; the map key is always `activeContactId`.
   */
  const activeThreadId = activeContactId;

  /** The generated group this chat view is showing, when it is a group. */
  const activeGroupObj = useMemo<MochiOsGroupData | undefined>(
    () =>
      activeGroupId
        ? ((savedPhoneDataResponse?.phoneData?.groups as MochiOsGroupData[] | undefined) || []).find(
            (group) => group.id === activeGroupId,
          )
        : undefined,
    [activeGroupId, savedPhoneDataResponse],
  );

  /** The thread on screen is a group chat, not a one-on-one chat. */
  const isGroupThread = Boolean(activeGroupId);
  /** The record type this thread's `<chat_history>` archive uses. */
  const activeRecordType: MochiChatRecordType = isGroupThread ? "group" : "private";

  /** Member names of the active group, in `main_members` then `other_members` order. */
  const activeGroupMemberNames = useMemo(() => splitMochiGroupMembers(activeGroupObj).names, [activeGroupObj]);

  /** The name the user's own messages are attributed to, as the group guide expects. */
  const userScreenName = profileNicknameDraft.trim() || activeLinkedPersona?.name?.trim() || "User";

  /**
   * The thread's record name: a group is addressed by its own name, which is what
   * its `<chat_history target="…">` archive is keyed by.
   */
  const groupThreadName = activeGroupObj?.name?.trim() || "Group";

  // Track pending un-replied user messages per contact
  const pendingUserMsgsQueueRef = useRef<{ [contactId: string]: MochiMessage[] }>({});
  const regeneratingContactRef = useRef<Set<string>>(new Set());
  const deletingContactRef = useRef<Set<string>>(new Set());
  // Track environment metadata YAML block per contact if received
  const lastEnvironmentYamlRef = useRef<{ [contactId: string]: string }>({});
  // User bubbles being answered by an in-flight generation. The archive does not
  // contain them until the response is archived, so hydration must keep showing
  // them instead of rebuilding the contact from the truncated file.
  const regeneratingUserMsgsRef = useRef<{ [contactId: string]: MochiMessage[] }>({});

  const persistMochiReactionRef = useRef<(msgIdx: number, reactions: MessageReaction[]) => void>(() => {});

  // Update locally, then persist to the exact bubble in its SillyTavern record.
  const handleDemoReaction = useCallback(
    (msgIdx: number, emoji: string, imageUrl: string | null) => {
      const contact = (isPrivateMode ? privateContactsRef.current : contactsRef.current)[activeContactId];
      const reactions = toggleReaction(contact?.msgs[msgIdx]?.reactions ?? [], emoji, USER_REACTOR, imageUrl);
      persistMochiReactionRef.current(msgIdx, reactions);
      const setter = isPrivateMode ? setPrivateContacts : setContacts;
      setter((prev) => {
        const contact = prev[activeContactId];
        if (!contact) return prev;
        const msgs = [...contact.msgs];
        const target = msgs[msgIdx];
        if (!target) return prev;
        const current = target.reactions ?? [];
        const next = toggleReaction(current, emoji, USER_REACTOR, imageUrl);
        msgs[msgIdx] = { ...target, reactions: next };
        return { ...prev, [activeContactId]: { ...contact, msgs } };
      });
    },
    [isPrivateMode, activeContactId],
  );

  const handleToggleDemoReactionEntry = useCallback(
    (msgIdx: number, reaction: MessageReaction) => {
      const contact = (isPrivateMode ? privateContactsRef.current : contactsRef.current)[activeContactId];
      persistMochiReactionRef.current(msgIdx, toggleReaction(contact?.msgs[msgIdx]?.reactions ?? [], reaction.emoji, USER_REACTOR, reaction.imageUrl ?? null, reactionTargetOf(reaction)));
      const setter = isPrivateMode ? setPrivateContacts : setContacts;
      setter((prev) => {
        const contact = prev[activeContactId];
        if (!contact) return prev;
        const msgs = [...contact.msgs];
        const target = msgs[msgIdx];
        if (!target) return prev;
        const current = target.reactions ?? [];
        const next = toggleReaction(
          current,
          reaction.emoji,
          USER_REACTOR,
          reaction.imageUrl ?? null,
          reactionTargetOf(reaction),
        );
        msgs[msgIdx] = { ...target, reactions: next };
        return { ...prev, [activeContactId]: { ...contact, msgs } };
      });
    },
    [isPrivateMode, activeContactId],
  );

  const handleRemoveDemoCharacterReaction = useCallback(
    (msgIdx: number, reaction: MessageReaction) => {
      const contact = (isPrivateMode ? privateContactsRef.current : contactsRef.current)[activeContactId];
      persistMochiReactionRef.current(msgIdx, removeCharacterReaction(contact?.msgs[msgIdx]?.reactions ?? [], reaction));
      const setter = isPrivateMode ? setPrivateContacts : setContacts;
      setter((prev) => {
        const contact = prev[activeContactId];
        if (!contact) return prev;
        const msgs = [...contact.msgs];
        const target = msgs[msgIdx];
        if (!target) return prev;
        const current = target.reactions ?? [];
        const next = removeCharacterReaction(current, reaction);
        msgs[msgIdx] = { ...target, reactions: next };
        return { ...prev, [activeContactId]: { ...contact, msgs } };
      });
    },
    [isPrivateMode, activeContactId],
  );

  // Hydrate Mochi contacts and group threads synchronously from canonical `<chat_history>`
  // records in roleplay messages so opening the Messages app has zero delay.
  const hydratedContactMaps = useMemo(() => {
    const personaName = activeLinkedPersona?.name?.trim() || "User";
    const groups = (savedPhoneDataResponse?.phoneData?.groups as MochiOsGroupData[] | undefined) || [];
    const groupKeyByName = new Map(groups.map((group) => [group.id, group.name?.trim().toLowerCase() || ""]));
    const parsedBlocks = activeChatRoleplayMessages
      .filter(
        (message) =>
          message.role === "assistant" &&
          /<(?:chat_history|privatechat_history|groupchat_history|group_message)\b/i.test(
            message.content,
          ),
      )
      .flatMap((message) => parseChatHistoryBlocks(message.content, personaName).map((block, recordIndex) => ({
        ...block,
        messages: block.messages.map((item, itemIndex) => ({
          ...item, id: mochiRoleplayBubbleId(message.id, recordIndex, itemIndex),
        })),
      })))
      .filter((block) => block.messages.length > 0);
    if (parsedBlocks.length === 0) {
      return { contacts: {} as MochiContactsMap, privateContacts: {} as MochiContactsMap };
    }
    const contactBlocks = mergeMochiChatHistoryBlocks(parsedBlocks);
    const buildOne = (prev: MochiContactsMap, parsedChat: (typeof contactBlocks)[number]): MochiContactsMap => {
      const targetName = parsedChat.target || parsedChat.name || primaryRoleplayCharName || "Character";
      const groupEntry = Array.from(groupKeyByName.entries()).find(([, name]) => name === targetName.toLowerCase());
      if (parsedChat.type === "group" && !groupEntry) {
        return prev;
      }
      const targetContactKey = parsedChat.type === "group" && groupEntry ? `group_${groupEntry[0]}` : "";
      if (parsedChat.type === "group" && !targetContactKey) {
        return prev;
      }
      const resolvedKey =
        targetContactKey ||
        Object.keys(privateContactsRef.current).find(
          (k) =>
            !k.startsWith("group_") &&
            (k.toLowerCase() === targetName.toLowerCase() ||
              privateContactsRef.current[k]?.name?.toLowerCase() === targetName.toLowerCase()),
        ) ||
        Object.keys(contactsRef.current).find(
          (k) =>
            !k.startsWith("group_") &&
            (k.toLowerCase() === targetName.toLowerCase() ||
              contactsRef.current[k]?.name?.toLowerCase() === targetName.toLowerCase()),
        ) ||
        targetName;

      const prevMsgs = (prev[resolvedKey]?.msgs ??
        (isPrivateMode ? privateContactsRef.current : contactsRef.current)[resolvedKey]?.msgs ??
        []) as MochiMessage[];
      const restoredMsgs: MochiMessage[] = parsedChat.messages.map((m, idx) => {
        const resolvedId = m.id || `local_${resolvedKey}_${idx}`;
        const existingMsg = prevMsgs.find((pm, pIdx) => (pm.id && pm.id === resolvedId) || pIdx === idx);
        return {
          id: resolvedId,
          me: m.me,
          type: m.type as any,
          text: m.text,
          dur: m.dur,
          t: m.time || "12:00 PM",
          d: m.date || parsedChat.date || "Today",
          sender: m.sender,
          rawItem: m.rawItem,
          reactions: m.reactions,
          ...(existingMsg?.swipes ? { swipes: existingMsg.swipes } : {}),
          ...(existingMsg?.activeSwipeIndex !== undefined ? { activeSwipeIndex: existingMsg.activeSwipeIndex } : {}),
        };
      });

      const lastMsg = restoredMsgs[restoredMsgs.length - 1];
      const preview = mochiMessagePreview(lastMsg);

      const charInPhoneData = [
        ...(savedPhoneDataResponse?.phoneData?.characters || []),
        ...(savedPhoneDataResponse?.phoneData?.private_contacts || []),
      ].find(
        (c) =>
          c.name?.toLowerCase() === targetName.toLowerCase() ||
          c.contactname?.toLowerCase() === targetName.toLowerCase() ||
          mochiSocialHandle(c).toLowerCase() === targetName.toLowerCase() ||
          (c.id && c.id.toLowerCase() === targetName.toLowerCase()),
      );
      const effectiveContactDisplayName =
        charInPhoneData?.contactname?.trim() || parsedChat.contactname?.trim() || targetName;

      return {
        ...prev,
        [resolvedKey]: {
          name: effectiveContactDisplayName,
          color: "var(--acc)",
          online: true,
          story: false,
          unread: 0,
          started: parsedChat.date || "Today",
          preview,
          msgs: restoredMsgs,
        },
      };
    };

    const nextContacts = contactBlocks.reduce((acc, block) => buildOne(acc, block), {} as MochiContactsMap);
    const privateBlocks = contactBlocks.filter((block) => block.type !== "group");
    const nextPrivateContacts = privateBlocks.reduce((acc, block) => buildOne(acc, block), {} as MochiContactsMap);
    return { contacts: nextContacts, privateContacts: nextPrivateContacts };
  }, [activeChatRoleplayMessages, activeLinkedPersona, isPrivateMode, primaryRoleplayCharName, savedPhoneDataResponse]);

  // Contacts for active mode (merge synchronous hydrated contacts with local state so chats and icons appear immediately)
  const currentContactsMap = useMemo<MochiContactsMap>(() => {
    const base = isPrivateMode ? hydratedContactMaps.privateContacts : hydratedContactMaps.contacts;
    const local = isPrivateMode ? privateContacts : contacts;
    return { ...base, ...local };
  }, [isPrivateMode, hydratedContactMaps, privateContacts, contacts]);

  persistMochiReactionRef.current = (msgIdx, reactions) => {
    if (!activeChatId) return;
    const contact = currentContactsMap[activeThreadId];
    if (!contact) return;
    const target = contact.msgs[msgIdx];
    const location = locateMochiMessageInRoleplay({
      roleplayMessages: activeChatRoleplayMessages, userName: userScreenName, targetName: contact.name,
      recordType: activeRecordType, threadIndex: msgIdx, threadMessageId: target?.id,
    });
    if (!location) {
      const pending = pendingUserMsgsQueueRef.current[activeThreadId]?.find((message) => message.id === target?.id);
      if (pending) pending.reactions = reactions;
      return;
    }
    void api.patch(`/chats/${activeChatId}/messages/${location.roleplayMessageId}/phone-reactions`, {
      recordType: activeRecordType, targetName: location.targetName, recordIndex: location.recordIndex,
      itemIndex: location.indexInRecord, itemId: target?.rawItem?.id, reactions,
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Could not save reaction"))
      .finally(() => { void qc.invalidateQueries({ queryKey: chatKeys.messages(activeChatId) }); });
  };

  // Message actions in Mochi OS chats (copy, edit, delete)
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editingMsgText, setEditingMsgText] = useState("");
  const savingMochiMessageRef = useRef(false);
  const editingThreadRef = useRef(activeThreadId);
  editingThreadRef.current = activeThreadId;

  const handleCopyMochiMessage = useCallback(async (msgIdx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgIdx(msgIdx);
      setTimeout(() => setCopiedMsgIdx((prev) => (prev === msgIdx ? null : prev)), 2000);
    } catch {
      // ignore
    }
  }, []);

  const handleStartEditMochiMessage = useCallback((msgIdx: number, currentText: string) => {
    setEditingMsgIdx(msgIdx);
    setEditingMsgText(currentText);
  }, []);

  const handleCancelEditMochiMessage = useCallback(() => {
    setEditingMsgIdx(null);
    setEditingMsgText("");
  }, []);

  const handleSaveEditMochiMessage = useCallback(
    async (msgIdx: number, targetMsgId?: string) => {
      const trimmed = editingMsgText.trim();
      if (!trimmed || savingMochiMessageRef.current) return;
      const targetId = activeThreadId;
      const currentContacts = currentContactsMap;
      const contact = currentContacts[targetId];
      if (!contact) return;
      const msgs = [...contact.msgs];
      // The selected position wins when imported ids repeat. Hydrated bubbles
      // have unique runtime keys, but those keys never enter the transcript.
      const resolvedIdx = !targetMsgId || msgs[msgIdx]?.id === targetMsgId ? msgIdx : msgs.findIndex((m) => m.id === targetMsgId);
      const actualIdx = resolvedIdx;
      const target = msgs[actualIdx];
      if (!target) return;
      const pending = pendingUserMsgsQueueRef.current[targetId]?.find((message) => message.id === target.id);
      savingMochiMessageRef.current = true;
      try {
        if (activeChatId && !pending) {
          const location = locateMochiMessageInRoleplay({
            roleplayMessages: activeChatRoleplayMessages,
            userName: activeLinkedPersona?.name || "User",
            targetName: contact.name || "",
            recordType: activeRecordType,
            threadIndex: actualIdx,
            threadMessageId: target.id,
          });
          if (!location) throw new Error("Could not find this bubble in the connected roleplay chat.");
          const saved = await api.patch<Message>(`/chats/${activeChatId}/messages/${location.roleplayMessageId}/phone-message`, {
            recordType: activeRecordType, targetName: location.targetName, recordIndex: location.recordIndex,
            itemIndex: location.indexInRecord, itemId: target.rawItem?.id, content: trimmed,
            expectedContent: activeChatRoleplayMessages.find((message) => message.id === location.roleplayMessageId)?.content,
          });
          if (!saved || saved.id !== location.roleplayMessageId) throw new Error("The connected roleplay message could not be updated.");
        }
        if (useChatStore.getState().activeChatId !== activeChatId) return;
        if (pending) {
          pending.text = trimmed;
          if (pending.rawItem) pending.rawItem = { ...pending.rawItem, c: trimmed };
        }
        const setter = isPrivateMode ? setPrivateContacts : setContacts;
        setter((prev) => {
          const current = prev[targetId] || contact;
          const nextMsgs = current.msgs.map((message, index) => (target.id ? message.id === target.id : index === actualIdx)
            ? { ...message, text: trimmed, rawItem: { ...message.rawItem, c: trimmed } }
            : message);
          return { ...prev, [targetId]: { ...current, msgs: nextMsgs, preview: mochiMessagePreview(nextMsgs.at(-1)) } };
        });
        if (editingThreadRef.current === targetId) {
          setEditingMsgIdx(null);
          setEditingMsgText("");
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save edit");
      } finally {
        savingMochiMessageRef.current = false;
        if (activeChatId) void qc.invalidateQueries({ queryKey: chatKeys.messages(activeChatId) });
      }
    },
    [
      activeThreadId,
      activeRecordType,
      editingMsgText,
      isPrivateMode,
      activeChatId,
      currentContactsMap,
      activeChatRoleplayMessages,
      activeLinkedPersona,
      qc,
    ],
  );

  const handleDeleteMochiMessage = useCallback(
    (msgIdx: number, targetMsgId?: string) => {
      const targetId = activeThreadId;
      if (deletingContactRef.current.has(targetId)) return;
      const currentContacts = currentContactsMap;
      const contact = currentContacts[targetId];
      if (!contact) return;
      const targetMessage = contact.msgs[msgIdx];
      if (!targetMessage) return;
      pendingUserMsgsQueueRef.current[targetId] = (pendingUserMsgsQueueRef.current[targetId] || [])
        .filter((message) => message.id !== targetMessage.id);
      const targetOccurrence = targetMsgId
        ? contact.msgs.slice(0, msgIdx).filter((message) => message.id === targetMsgId).length
        : 0;
      const setter = isPrivateMode ? setPrivateContacts : setContacts;
      setter((prev) => {
        const current = prev[targetId];
        if (!current) return prev;
        // Always derive from the latest state. Rapid deletes previously each
        // filtered a render-time snapshot, allowing a later update to restore a
        // message removed by the preceding click.
        const currentTargetIndex = targetMsgId
          ? current.msgs
              .map((message, index) => ({ message, index }))
              .filter(({ message }) => message.id === targetMsgId)[targetOccurrence]?.index
          : msgIdx;
        if (currentTargetIndex === undefined || !current.msgs[currentTargetIndex]) return prev;
        const nextMsgs = removeMochiThreadMessage(current.msgs, currentTargetIndex);
        if (nextMsgs.length === current.msgs.length) return prev;
        const lastMsg = nextMsgs[nextMsgs.length - 1];
        const hasCharacterMessages = nextMsgs.some((message) => message.me !== 1);
        const preview = hasCharacterMessages ? mochiMessagePreview(lastMsg) : "";
        return {
          ...prev,
          [targetId]: {
            ...current,
            preview,
            // The server removes the user inputs in a record when its final
            // character reply is deleted. Mirror that behavior locally.
            msgs: nextMsgs,
          },
        };
      });

      // The thread on screen is the concatenation of every `<chat_history>`
      // record for this thread, one record per generated turn, so a UI index
      // cannot be applied to a single record directly. Resolve which roleplay
      // message actually holds this bubble before touching it.
      if (activeChatId) {
        const targetName = isGroupThread ? groupThreadName : contact.name || "";
        const location = locateMochiMessageInRoleplay({
          roleplayMessages: activeChatRoleplayMessages,
          userName: activeLinkedPersona?.name || "User",
          targetName,
          recordType: activeRecordType,
          threadIndex: msgIdx,
          threadMessageId: targetMsgId,
        });
        if (location) {
          void api.patch(`/chats/${activeChatId}/messages/${location.roleplayMessageId}/phone-message`, {
            recordType: activeRecordType, targetName: location.targetName, recordIndex: location.recordIndex, itemIndex: location.indexInRecord,
            itemId: targetMessage.rawItem?.id, delete: true,
          }).catch((error) => toast.error(error instanceof Error ? error.message : "Could not delete message"))
            .finally(() => { void qc.invalidateQueries({ queryKey: chatKeys.messages(activeChatId) }); });
        }
      }
      if (editingMsgIdx === msgIdx) {
        setEditingMsgIdx(null);
        setEditingMsgText("");
      }
    },
    [
      activeThreadId,
      activeRecordType,
      activeGroupMemberNames,
      groupThreadName,
      isGroupThread,
      editingMsgIdx,
      isPrivateMode,
      activeChatId,
      currentContactsMap,
      activeChatRoleplayMessages,
      activeLinkedPersona?.name,
      qc,
    ],
  );

  const handleRegenerateMochiMessage = useCallback(
    async (msgIdx: number) => {
      const targetId = activeThreadId;
      if (regeneratingContactRef.current.has(targetId)) return;
      regeneratingContactRef.current.add(targetId);
      const currentContacts = currentContactsMap;
      const contact = currentContacts[targetId];
      if (!contact) {
        regeneratingContactRef.current.delete(targetId);
        return;
      }
      const originalMsgs = [...contact.msgs];
      const originalPreview = contact.preview;
      const originalEnvironmentYaml = lastEnvironmentYamlRef.current[targetId];
      let restoredAfterFailure = false;

      const restoreRegeneratedTurn = async () => {
        if (restoredAfterFailure) return;
        restoredAfterFailure = true;

        const setter = isPrivateMode ? setPrivateContacts : setContacts;
        setter((prev) => {
          const current = prev[targetId];
          if (!current) return prev;
          return {
            ...prev,
            [targetId]: { ...current, preview: originalPreview, msgs: originalMsgs },
          };
        });

        if (originalEnvironmentYaml) {
          lastEnvironmentYamlRef.current[targetId] = originalEnvironmentYaml;
        } else {
          delete lastEnvironmentYamlRef.current[targetId];
        }
        delete regeneratingUserMsgsRef.current[targetId];

        regeneratingContactRef.current.delete(targetId);
      };

      // A turn ends where its archived record ends. Pressing refresh on an empty
      // composer appends a record holding only character replies, so those
      // replies sit directly on the previous turn's replies in the merged
      // thread and look like one longer turn. The record is the only place the
      // boundary exists, so resolve it first.
      const location = activeChatId
        ? locateMochiMessageInRoleplay({
            roleplayMessages: activeChatRoleplayMessages,
            userName: activeLinkedPersona?.name || "User",
            targetName: contact.name || "",
            recordType: activeRecordType,
            threadIndex: msgIdx,
            threadMessageId: contact.msgs[msgIdx]?.id,
          })
        : null;
      const turn = resolveMochiRegenerationTurn({ msgs: contact.msgs, bubbleIndex: msgIdx, location });

      // The inputs this turn was generated from. A continuation turn has none,
      // so regenerating it resends nothing and only replaces its own replies.
      const inputUserMsgs: MochiMessage[] = turn.isContinuation
        ? []
        : contact.msgs.slice(turn.inputStartIndex, turn.cutIndex);
      const cutIdx = turn.cutIndex;
      // The prompt's history stops where the replaced turn begins, which for a
      // continuation record is the record itself rather than the pressed bubble.
      const regeneratedTurnStartIdx = turn.historyCutIndex;

      const trimmedMsgs = contact.msgs.slice(0, cutIdx);
      // The user messages in this turn are resent to generation. They must not
      // remain in the archived history as an old chat_history record, otherwise
      // the replacement turn is appended below a duplicate of the turn being
      // regenerated.
      const historyBeforeRegeneratedTurn = contact.msgs.slice(0, regeneratedTurnStartIdx);
      // What stays on screen while regeneration runs. A normal turn keeps its
      // resent user inputs and erases only the replies after them; a continuation
      // turn has no inputs, so every reply in its record is being replaced and
      // must disappear too. Trimming at cutIdx would leave the earlier replies of
      // that character-only record on screen until generation finishes, since for
      // a continuation cutIdx equals the pressed bubble's own index.
      const visibleMsgsDuringGeneration = contact.msgs.slice(
        0,
        mochiRegenerationVisibleMessageCount({
          isContinuation: turn.isContinuation,
          recordStartIndex: location?.recordStartIndex,
          cutIndex: cutIdx,
        }),
      );
      const lastMsg = visibleMsgsDuringGeneration[visibleMsgsDuringGeneration.length - 1];
      const preview = mochiMessagePreview(lastMsg);

      const setter = isPrivateMode ? setPrivateContacts : setContacts;
      // Hold these bubbles for the duration of the request so a mid-generation
      // rehydration cannot hide them.
      if (inputUserMsgs.length > 0) {
        regeneratingUserMsgsRef.current[targetId] = [...inputUserMsgs];
      }
      setter((prev) => {
        const c = prev[targetId] ?? currentContactsMap[targetId];
        if (!c) return prev;
        return { ...prev, [targetId]: { ...c, preview, msgs: visibleMsgsDuringGeneration } };
      });

      if (activeChatId) {
        const targetName = location?.targetName || contact.name || "Character";
        // Only the records of this thread's own kind are candidates. A private
        // chat and a group can share an archive and even a name, so the record
        // type is what keeps one thread's regeneration from truncating the other.
        const taggedMessages = activeChatRoleplayMessages.filter((message) => {
          if (message.role !== "assistant") return false;
          const block = parseChatHistoryBlocks(message.content, activeLinkedPersona?.name || "User", {
            recordType: activeRecordType,
          }).find((entry) => [entry.target, entry.contactname, entry.name].some((name) => name?.trim().toLowerCase() === targetName.trim().toLowerCase()));
          return block?.type === activeRecordType;
        });
        // Replace only from the record that actually holds this turn. Falling back to
        // the newest record would delete every turn after the one being
        // regenerated whenever an older bubble is regenerated.
        const replaceFrom =
          (location ? taggedMessages.find((message) => message.id === location.roleplayMessageId) : undefined) ||
          taggedMessages[taggedMessages.length - 1];
        if (replaceFrom) {
          const deleteTail = taggedMessages.slice(taggedMessages.indexOf(replaceFrom) + 1);
          void handleTriggerAiGenerationRef
            .current?.(
              inputUserMsgs.length > 0 ? inputUserMsgs : undefined,
              historyBeforeRegeneratedTurn,
              restoreRegeneratedTurn,
              [replaceFrom.id, ...deleteTail.map((message) => message.id)],
              () => {
                regeneratingContactRef.current.delete(targetId);
                delete regeneratingUserMsgsRef.current[targetId];
              },
              replaceFrom.id,
              deleteTail.map((message) => message.id),
            )
            .catch((err) => {
              void restoreRegeneratedTurn();
              console.error("Failed to replace Mochi OS chat roleplay record:", err);
            });
          return;
        }
      }

      if (!activeChatId) {
        await handleTriggerAiGenerationRef.current?.(
          inputUserMsgs.length > 0 ? inputUserMsgs : undefined,
          trimmedMsgs,
          restoreRegeneratedTurn,
          [],
          () => {
            regeneratingContactRef.current.delete(targetId);
            delete regeneratingUserMsgsRef.current[targetId];
          },
        );
        return;
      }

      // Populate pendingUserMsgsQueueRef with the user's inputs so AI generation resends them instead of "continue"
      if (inputUserMsgs.length > 0) {
        pendingUserMsgsQueueRef.current[targetId] = [...inputUserMsgs];
      }

      void handleTriggerAiGenerationRef
        .current?.(
          inputUserMsgs.length > 0 ? inputUserMsgs : undefined,
          trimmedMsgs,
          restoreRegeneratedTurn,
          [],
          () => {
            regeneratingContactRef.current.delete(targetId);
            delete regeneratingUserMsgsRef.current[targetId];
          },
        )
        .catch((err) => {
          void restoreRegeneratedTurn();
          console.error("Failed to regenerate Mochi OS chat:", err);
        });
    },
    [
      activeThreadId,
      activeRecordType,
      activeChatId,
      isPrivateMode,
      currentContactsMap,
      activeChatRoleplayMessages,
      activeLinkedPersona,
    ],
  );

  const handleSwipeMochiMessage = useCallback(
    (msgIdx: number, delta: -1 | 1) => {
      const targetId = activeThreadId;
      const currentContacts = currentContactsMap;
      const contact = currentContacts[targetId];
      if (!contact) return;

      if (activeChatId) {
        const location = locateMochiMessageInRoleplay({
          roleplayMessages: activeChatRoleplayMessages,
          userName: activeLinkedPersona?.name || "User",
          targetName: contact.name || "",
          recordType: activeRecordType,
          threadIndex: msgIdx,
          threadMessageId: contact.msgs[msgIdx]?.id,
        });
        const rpMsg = location
          ? activeChatRoleplayMessages.find((msg) => msg.id === location.roleplayMessageId)
          : undefined;
        if (rpMsg) {
          const currentIdx = rpMsg.activeSwipeIndex ?? 0;
          const swipeCount = rpMsg.swipeCount ?? 1;
          const nextIdx = currentIdx + delta;
          if (nextIdx >= 0 && nextIdx < swipeCount) {
            void setActiveSwipe.mutateAsync({ messageId: rpMsg.id, index: nextIdx });
          } else if (delta === 1 && nextIdx >= swipeCount) {
            void handleRegenerateMochiMessage(msgIdx);
          }
          return;
        }
      }

      const targetMsg = contact.msgs[msgIdx];
      if (!targetMsg) return;
      const swipes = targetMsg.swipes?.length ? targetMsg.swipes : [targetMsg.text || ""];
      const currentIdx = targetMsg.activeSwipeIndex ?? swipes.length - 1;
      const nextIdx = currentIdx + delta;
      if (nextIdx >= 0 && nextIdx < swipes.length) {
        const setter = isPrivateMode ? setPrivateContacts : setContacts;
        setter((prev) => {
          const c = prev[targetId] ?? currentContactsMap[targetId];
          if (!c) return prev;
          const nextMsgs = [...c.msgs];
          nextMsgs[msgIdx] = {
            ...targetMsg,
            text: swipes[nextIdx],
            activeSwipeIndex: nextIdx,
          };
          const last = nextMsgs[nextMsgs.length - 1];
          return { ...prev, [targetId]: { ...c, preview: mochiMessagePreview(last), msgs: nextMsgs } };
        });
      } else if (delta === 1 && nextIdx >= swipes.length) {
        void handleRegenerateMochiMessage(msgIdx);
      }
    },
    [
      activeThreadId,
      isPrivateMode,
      currentContactsMap,
      activeChatId,
      activeChatRoleplayMessages,
      activeLinkedPersona?.name,
      activeRecordType,
      setActiveSwipe,
      handleRegenerateMochiMessage,
    ],
  );

  const handleBranchMochiMessage = useCallback(
    async (msgIdx: number) => {
      if (!activeChatId || branchChat.isPending || branchPendingRef.current) return;
      const contact = currentContactsMap[activeThreadId];
      if (!contact) return;
      const location = locateMochiMessageInRoleplay({
        roleplayMessages: activeChatRoleplayMessages,
        userName: activeLinkedPersona?.name || "User",
        targetName: contact.name,
        recordType: activeRecordType,
        threadIndex: msgIdx,
        threadMessageId: contact.msgs[msgIdx]?.id,
      });
      const upToMessageId = location?.roleplayMessageId;
      if (!upToMessageId) return;
      branchPendingRef.current = true;
      const confirmed = await showConfirmDialog({
        title: localizeUi("ui.chat.chatarea.createANewBranch"),
        message: localizeUi("ui.chat.chatarea.thisWillCopyTheChatThroughThisMessageAnd"),
        confirmLabel: localizeUi("ui.chat.chatarea.createBranch"),
      });
      if (!confirmed || useChatStore.getState().activeChatId !== activeChatId) {
        branchPendingRef.current = false;
        return;
      }
      const branchToastId = toast.loading(localizeUi("ui.chat.chatarea.creatingBranch", "Creating branch..."));
      branchChat.mutate(
        { chatId: activeChatId, upToMessageId },
        {
          onSuccess: async (newChat) => {
            if (newChat) {
              useChatStore.getState().setActiveChatId(newChat.id);
            }
            toast.success(localizeUi("ui.chat.chatarea.branchCreated"));
          },
          onError: (error) => {
            toast.error(
              error instanceof Error
                ? localizeUi("ui.chat.chatarea.branchFailedValue1", { value1: error.message })
                : localizeUi("ui.chat.chatarea.branchFailed"),
            );
          },
          onSettled: () => {
            branchPendingRef.current = false;
            toast.dismiss(branchToastId);
          },
        },
      );
    },
    [
      activeChatId,
      activeThreadId,
      activeRecordType,
      activeChatRoleplayMessages,
      activeLinkedPersona?.name,
      branchChat,
      currentContactsMap,
      localizeUi,
    ],
  );

  // Messages inputs & filter
  const [chatSearchText, setChatSearchText] = useState("");
  const [callsSearchText, setCallsSearchText] = useState("");
  const [peopleSearchText, setPeopleSearchText] = useState("");
  const [msgInputText, setMsgInputText] = useState("");
  const [replyingToMochiMessage, setReplyingToMochiMessage] = useState<MochiReplyTarget | null>(null);
  const [composerPlusOpen, setComposerPlusOpen] = useState(false);
  const { activeId: activeMochiMsgActionId, interaction: mochiMessageInteraction, dismiss: dismissMochiMessageActions } = useMochiMessageActions(
    setReplyingToMochiMessage, `${activeChatId}:${activeThreadId}:${isPrivateMode}`,
  );
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setReplyingToMochiMessage(null);
    setMediaPickerOpen(false);
    setComposerPlusOpen(false);
    setEditingMsgIdx(null);
    setEditingMsgText("");
  }, [activeChatId, activeThreadId, isPrivateMode, inChatView]);
  useEffect(() => {
    if (!composerPlusOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.mochi-composer')) setComposerPlusOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [composerPlusOpen]);

  // Images Modal sub-state
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [imgUrl, setImgUrl] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiSearch, setAiSearch] = useState("");
  const [aiSelectedNames, setAiSelectedNames] = useState<string[]>([]);
  const [imgDescription, setImgDescription] = useState("");

  // Drag & drop reorder state for prompt blocks
  const [draggedBlockIdx, setDraggedBlockIdx] = useState<number | null>(null);

  // Centralized helper to apply <environment> tags to clock and weather widgets when "Let AI Decide" is enabled
  const applyEnvironmentUpdate = useCallback(
    (rawOutput: string) => {
      if (!rawOutput || (!clockAiDecide && !wxAiDecide)) return;
      const parsedEnv = parseEnvironmentYaml(rawOutput);
      if (!parsedEnv) return;

      if (clockAiDecide) {
        // Date and Time matching: retain fixed date and time from <environment> until a new one is generated
        if (parsedEnv.date) {
          const dateStr = parsedEnv.date.replace(/^["']|["']$/g, "").trim();
          if (dateStr) {
            setAiDecidedDate(dateStr);
          }
        }
        if (parsedEnv.time) {
          const timeStr = parsedEnv.time.replace(/^["']|["']$/g, "").trim();
          if (timeStr) {
            setAiDecidedTime(timeStr);
          }
        }
      }

      if (wxAiDecide) {
        if (parsedEnv.weather) {
          const newCond = parsedEnv.weather.replace(/^["']|["']$/g, "").trim();
          if (newCond) {
            setWxCondition(newCond);
          }
        }
        if (parsedEnv.temperature) {
          const rawTemp = parsedEnv.temperature.replace(/^["']|["']$/g, "").trim();
          const num = parseFloat(rawTemp);
          if (!isNaN(num)) {
            const numInC = rawTemp.toUpperCase().includes("F") || tempUnit === "F" ? ((num - 32) * 5) / 9 : num;
            setWxTemp(numInC);
          }
        }
        if (parsedEnv.location) {
          const newLoc = parsedEnv.location.replace(/^["']|["']$/g, "").trim();
          if (newLoc && newLoc.toLowerCase() !== "not specified") {
            setWxPlace(newLoc);
          }
        }
      }
    },
    [clockAiDecide, wxAiDecide, tempUnit],
  );

  // Show the weather and clock the thread's archived turns declared.
  // The widgets read from the most recent <environment> tags in roleplay messages.
  useEffect(() => {
    if (activeChatRoleplayMessages.length === 0) return;
    const environmentRegex = /<environment>[\s\S]*?<\/environment>/gi;
    let mostRecentEnv: string | null = null;
    for (let i = activeChatRoleplayMessages.length - 1; i >= 0; i--) {
      const msg = activeChatRoleplayMessages[i];
      if (msg?.role !== "assistant" || !msg.content) continue;
      const matches = Array.from(msg.content.matchAll(environmentRegex));
      if (matches.length > 0) {
        mostRecentEnv = matches[matches.length - 1][0];
        break;
      }
    }
    if (!mostRecentEnv) return;
    applyEnvironmentUpdate(mostRecentEnv);
  }, [activeChatRoleplayMessages, applyEnvironmentUpdate]);

  useEffect(() => {
    if (!activeChatMessagesData) return;
    const reconcile = (local: MochiContactsMap, archived: MochiContactsMap) => reconcileMochiContactHistory({
      local, archived, pendingUserMessages: pendingUserMsgsQueueRef.current,
      regeneratingThreadIds: regeneratingContactRef.current,
    });
    // Replace rather than only merge: a thread's last record can disappear while
    // other contacts still have records, or the entire roleplay chat can be empty.
    setContacts((prev) => reconcile(prev, hydratedContactMaps.contacts));
    setPrivateContacts((prev) => reconcile(prev, hydratedContactMaps.privateContacts));
  }, [activeChatMessagesData, hydratedContactMaps]);
  const [dragOverBlockIdx, setDragOverBlockIdx] = useState<number | null>(null);

  // Voice Note Recording State
  const [recording, setRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const [recDur, setRecDur] = useState(0);
  const [hasRecordedAudio, setHasRecordedAudio] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  // MediaRecorder refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const recIntervalRef = useRef<number | null>(null);
  const recStartTimeRef = useRef<number>(0);

  const isHour12 = timeFormat === "12h";

  // Live timer tick
  useEffect(() => {
    const timer = setInterval(() => {
      setNowDate(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Compute live formatted clock & subtext
  const { liveTime, liveDateStr, liveWeekday } = useMemo(() => {
    let d: Date;
    let timeStr = "";
    let dateStr = "";
    let weekdayStr = "";

    if (clockAiDecide && (aiDecidedDate || aiDecidedTime)) {
      dateStr =
        aiDecidedDate ||
        new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(nowDate);
      try {
        const parsedD = new Date(aiDecidedDate);
        weekdayStr = !isNaN(parsedD.getTime())
          ? new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(parsedD)
          : new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(nowDate);
      } catch {
        weekdayStr = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(nowDate);
      }
      timeStr = aiDecidedTime || fmtTime(nowDate, isHour12);
    } else if (clockMode === "tz") {
      d = nowDate;
      try {
        dateStr = new Intl.DateTimeFormat("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: clockTz,
        }).format(d);
        weekdayStr = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: clockTz }).format(d);
        const parts = new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: clockTz,
        }).formatToParts(d);
        const h = +parts.find((p) => p.type === "hour")!.value;
        const mi = +parts.find((p) => p.type === "minute")!.value;
        timeStr = fmtHm(h, mi, isHour12);
      } catch {
        timeStr = fmtTime(d, isHour12);
        dateStr = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        weekdayStr = d.toLocaleDateString("en-US", { weekday: "long" });
      }
    } else {
      d = new Date(nowDate.getTime() + clockOffset);
      dateStr = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(d);
      weekdayStr = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(d);
      timeStr = fmtTime(d, isHour12);
    }

    return { liveTime: timeStr, liveDateStr: dateStr, liveWeekday: weekdayStr };
  }, [nowDate, clockMode, clockTz, clockOffset, clockAiDecide, aiDecidedDate, aiDecidedTime, isHour12]);

  // Weather formatted
  const formattedWx = useMemo(() => {
    const isF = tempUnit === "F";
    const val = isF ? Math.round((wxTemp * 9) / 5 + 32) : Math.round(wxTemp);
    const big = `${val}°${isF ? "F" : "C"}`;
    const sub = `${wxCondition}${wxPlace ? ` · ${wxPlace}` : ""}`;
    return { big, sub };
  }, [tempUnit, wxTemp, wxCondition, wxPlace]);

  // Voice recording helper functions
  const resetVoice = useCallback(() => {
    if (recIntervalRef.current) {
      clearInterval(recIntervalRef.current);
      recIntervalRef.current = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.onended = null;
      audioElementRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    setRecording(false);
    setRecElapsed(0);
    setRecDur(0);
    setHasRecordedAudio(false);
    setPreviewPlaying(false);
  }, []);

  // Helper to safely navigate back from chat view and clean up empty contacts
  const handleExitChatView = useCallback(() => {
    setInChatView(false);
    setGroupInfoOpen(false);

    if (activeContactId && !activeGroupId) {
      const setter = isPrivateMode ? setPrivateContacts : setContacts;
      setter((prev) => {
        const contact = prev[activeContactId];
        if (contact && (!contact.msgs || contact.msgs.length === 0) && !contact.preview) {
          const next = { ...prev };
          delete next[activeContactId];
          return next;
        }
        return prev;
      });
    }
  }, [activeContactId, activeGroupId, isPrivateMode]);

  // Close top modal or back out of chat on Escape
  useEffect(() => {
    const handleKeyDown = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.type === "mochios:escape" || e instanceof KeyboardEvent) {
        const consume = (action: () => void) => {
          e.preventDefault();
          e.stopPropagation();
          action();
        };
        if (mediaPickerOpen) {
          consume(() => setMediaPickerOpen(false));
          return;
        }
        if (composerPlusOpen) {
          consume(() => setComposerPlusOpen(false));
          return;
        }
        if (editingMsgIdx !== null) {
          consume(handleCancelEditMochiMessage);
          return;
        }
        if (activeMochiMsgActionId !== null) {
          consume(dismissMochiMessageActions);
          return;
        }
        if (replyingToMochiMessage) {
          consume(() => setReplyingToMochiMessage(null));
          return;
        }
        if (aiDataModalOpen) {
          consume(handleCloseAiDataModal);
          return;
        }
        if (voiceModalOpen) {
          consume(() => { resetVoice(); setVoiceModalOpen(false); });
          return;
        }
        if (imagesModalOpen) {
          consume(() => setImagesModalOpen(false));
          return;
        }
        if (transferModalOpen) {
          consume(() => setTransferModalOpen(false));
          return;
        }
        if (clockModalOpen) {
          consume(() => setClockModalOpen(false));
          return;
        }
        if (wxModalOpen) {
          consume(() => setWxModalOpen(false));
          return;
        }
        if (settingsModalOpen) {
          consume(() => setSettingsModalOpen(false));
          return;
        }
        if (groupInfoOpen) {
          consume(() => setGroupInfoOpen(false));
          return;
        }
        if (inChatView) {
          consume(handleExitChatView);
          return;
        }
        if (messagesAppOpen) {
          consume(() => setMessagesAppOpen(false));
          return;
        }
        if (appStoreOpen) {
          consume(() => setAppStoreOpen(false));
          return;
        }
        if (isAppEditingMode) {
          consume(() => setIsAppEditingMode(false));
          return;
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mochios:escape", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mochios:escape", handleKeyDown);
    };
  }, [
    mediaPickerOpen,
    composerPlusOpen,
    editingMsgIdx,
    handleCancelEditMochiMessage,
    activeMochiMsgActionId,
    dismissMochiMessageActions,
    replyingToMochiMessage,
    aiDataModalOpen,
    handleCloseAiDataModal,
    voiceModalOpen,
    imagesModalOpen,
    transferModalOpen,
    clockModalOpen,
    wxModalOpen,
    settingsModalOpen,
    groupInfoOpen,
    inChatView,
    handleExitChatView,
    messagesAppOpen,
    appStoreOpen,
    isAppEditingMode,
    resetVoice,
  ]);

  // Weather loader function
  const loadWxData = useCallback(
    async (lat: number, lon: number, place: string) => {
      try {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`,
        );
        const j = await r.json();
        const nextTemp = j.current_weather.temperature;
        const nextCond = wxLabel(j.current_weather.weathercode);
        setWxTemp(nextTemp);
        setWxCondition(nextCond);
        setWxPlace(place);
        saveSettings({ wxTemp: nextTemp, wxCondition: nextCond, wxPlace: place });
        setWxModalOpen(false);
      } catch {
        setWxErr("Could not load weather.");
      }
    },
    [saveSettings],
  );

  const handleWxSearch = async () => {
    const q = wxQuery.trim();
    if (!q) return;
    setWxErr("");
    setWxSearching(true);
    setWxResults([]);
    try {
      const r = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`,
      );
      const j = await r.json();
      setWxSearching(false);
      if (!j.results || !j.results.length) {
        setWxResults([]);
        return;
      }
      const mapped = j.results.map((p: any) => ({
        name: p.name,
        region: [p.admin1, p.country].filter(Boolean).join(", "),
        lat: p.latitude,
        lon: p.longitude,
      }));
      setWxResults(mapped);
    } catch {
      setWxSearching(false);
      setWxErr("Search failed — check your connection.");
    }
  };

  const handleGpsWx = () => {
    if (!navigator.geolocation) {
      setWxErr("Geolocation not supported.");
      return;
    }
    setWxErr("");
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const { latitude: la, longitude: lo } = p.coords;
        let place = "My location";
        try {
          const r = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${la}&longitude=${lo}&localityLanguage=en`,
          );
          const j = await r.json();
          place = j.city || j.locality || place;
        } catch {
          // ignore
        }
        await loadWxData(la, lo, place);
        setGpsLoading(false);
      },
      () => {
        setWxErr("Location permission denied.");
        setGpsLoading(false);
      },
    );
  };

  const handleApplyCustomWx = () => {
    let t = wxTemp;
    const parsed = parseFloat(customWxTemp);
    if (!isNaN(parsed)) {
      // Convert to Celsius if user entered Fahrenheit
      t = tempUnit === "F" ? ((parsed - 32) * 5) / 9 : parsed;
      setWxTemp(t);
    }
    const cond = customWxCondChoice === "__custom" ? customWxCondText.trim() || "Custom" : customWxCondChoice;
    const place = customWxLoc.trim();
    setWxCondition(cond);
    setWxPlace(place);
    saveSettings({ wxTemp: t, wxCondition: cond, wxPlace: place });
    setWxModalOpen(false);
  };

  // Clock widget click
  const handleOpenClockSettings = () => {
    const currentClockDate = clockMode === "custom" ? new Date(Date.now() + clockOffset) : new Date();
    setCalView(() => {
      const d = new Date(currentClockDate);
      d.setDate(1);
      return d;
    });
    setCalSel(new Date(currentClockDate));
    const h = currentClockDate.getHours();
    if (isHour12) {
      setCustomHour(h % 12 || 12);
      setCustomAmPm(h < 12 ? "AM" : "PM");
    } else {
      setCustomHour(h);
      setCustomAmPm(h < 12 ? "AM" : "PM");
    }
    setCustomMin(currentClockDate.getMinutes());
    setTempTz(clockTz);
    setClockModalOpen(true);
  };

  const handleApplyTz = () => {
    setClockMode("tz");
    setClockTz(tempTz);
    saveSettings({ clockMode: "tz", clockTz: tempTz });
    setClockModalOpen(false);
  };

  const handleApplyCustomClock = () => {
    let h = customHour;
    if (isHour12) {
      h = h % 12;
      if (customAmPm === "PM") h += 12;
    }
    const chosen = new Date(calSel.getFullYear(), calSel.getMonth(), calSel.getDate(), h, customMin);
    const nextOffset = chosen.getTime() - Date.now();
    setClockMode("custom");
    setClockOffset(nextOffset);
    saveSettings({ clockMode: "custom", clockOffset: nextOffset });
    setClockModalOpen(false);
  };

  const beginVoiceRecording = async () => {
    resetVoice();
    setRecording(true);
    setRecElapsed(0);
    recStartTimeRef.current = Date.now();

    recIntervalRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - recStartTimeRef.current) / 1000;
      setRecElapsed(elapsed);
    }, 100);

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        const mr = new MediaRecorder(stream);
        mediaRecorderRef.current = mr;
        recordedChunksRef.current = [];
        mr.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunksRef.current.push(e.data);
          }
        };
        mr.onstop = () => {
          if (recordedChunksRef.current.length > 0) {
            const blob = new Blob(recordedChunksRef.current, {
              type: mr.mimeType || "audio/webm",
            });
            const url = URL.createObjectURL(blob);
            audioElementRef.current = new Audio(url);
          }
        };
        mr.start();
      } catch {
        // Fallback to simulated audio without real microphone
      }
    }
  };

  const finishVoiceRecording = () => {
    if (recIntervalRef.current) {
      clearInterval(recIntervalRef.current);
      recIntervalRef.current = null;
    }
    setRecording(false);
    const finalDur = recElapsed > 0.5 ? recElapsed : Math.max(recElapsed, 1);
    setRecDur(finalDur);
    setHasRecordedAudio(true);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  };

  const handleToggleVoicePlay = () => {
    if (!audioElementRef.current) {
      // Simulated play for non-mic environment
      setPreviewPlaying((prev) => !prev);
      return;
    }
    const audio = audioElementRef.current;
    if (audio.paused) {
      audio.currentTime = 0;
      audio.play();
      setPreviewPlaying(true);
      audio.onended = () => {
        setPreviewPlaying(false);
      };
    } else {
      audio.pause();
      setPreviewPlaying(false);
    }
  };

  const handleDeletePreview = () => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }
    setHasRecordedAudio(false);
    setRecElapsed(0);
    setRecDur(0);
    setPreviewPlaying(false);
  };

  // Chat message push helper
  const pushMessageToCurrentContact = useCallback(
    (msg: MochiMessage) => {
      const targetId = activeThreadId;
      const currentContacts = currentContactsMap;
      const existingContact = currentContacts[targetId];
      const lastMsg = existingContact?.msgs?.[existingContact.msgs.length - 1];

      // Determine the effective date for the message:
      // 1. If clockAiDecide is enabled and an AI decided date exists, use it.
      // 2. Otherwise, if the conversation already has a date from previous messages or started, reuse it so we don't introduce a mismatched date.
      // 3. Otherwise fall back to liveDateStr or formatted local date.
      const fallbackDate =
        existingContact?.started && existingContact.started !== "Today"
          ? existingContact.started
          : lastMsg?.d ||
            liveDateStr ||
            new Date().toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            });
      const dateFormatted = clockAiDecide
        ? aiDecidedDate || lastMsg?.d || existingContact?.started || fallbackDate
        : lastMsg?.d || fallbackDate;

      // Determine the effective time for user message:
      // If clockAiDecide is enabled and we have an AI decided time (or liveTime), use it;
      // otherwise, if following a previous message, advance from last message or use liveTime.
      const timeFormatted = clockAiDecide
        ? aiDecidedTime || liveTime || (lastMsg?.t ? lastMsg.t : fmtTime(new Date(), isHour12))
        : liveTime || fmtTime(new Date(), isHour12);

      const assignedId = msg.id || `phone_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

      // In a group, the user's own messages are attributed too, so the transcript
      // reads the same whoever is looking at it.
      const completeMsg: MochiMessage = {
        ...msg,
        id: assignedId,
        d: msg.d || dateFormatted,
        t: msg.t || timeFormatted,
        ...(isGroupThread && msg.me === 1 ? { sender: userScreenName } : {}),
      };

      // Track in pending user queue if it's a user message
      if (completeMsg.me === 1) {
        if (!pendingUserMsgsQueueRef.current[targetId]) {
          pendingUserMsgsQueueRef.current[targetId] = [];
        }
        pendingUserMsgsQueueRef.current[targetId]!.push(completeMsg);
      }

      const setter = isPrivateMode ? setPrivateContacts : setContacts;
      setter((prev) => {
        const contact = prev[targetId] || currentContactsMap[targetId] || {
          name: isGroupThread ? groupThreadName : "Contact",
          color: "var(--acc)",
          online: true,
          story: false,
          unread: 0,
          started: dateFormatted,
          preview: "",
          msgs: [],
        };
        const newPreview = mochiMessagePreview(completeMsg);
        const updatedContact = {
          ...contact,
          preview: newPreview,
          msgs: [...contact.msgs, completeMsg],
        };

        return {
          ...prev,
          [targetId]: updatedContact,
        };
      });
    },
    [
      isPrivateMode,
      activeThreadId,
      isGroupThread,
      groupThreadName,
      userScreenName,
      isHour12,
      clockAiDecide,
      aiDecidedDate,
      aiDecidedTime,
      liveDateStr,
      liveTime,
      privateContacts,
      contacts,
      currentContactsMap,
    ],
  );

  // Dynamic chat input placeholder matching Conversation mode
  const chatInputPlaceholder = useMemo(() => {
    if (activeGroupId && savedPhoneDataResponse?.phoneData?.groups) {
      const group = (savedPhoneDataResponse.phoneData.groups as MochiOsGroupData[]).find(
        (g: MochiOsGroupData) => g.id === activeGroupId,
      );
      if (group?.name) {
        return localizeUi("chat.input.messageCharacters", { names: `@${group.name}` });
      }
    }
    const currentContacts = isPrivateMode ? privateContacts : contacts;
    const contact = currentContacts[activeContactId];
    if (contact?.name) {
      return localizeUi("chat.input.messageCharacters", { names: `@${contact.name}` });
    }
    return localizeUi("chat.input.message");
  }, [activeGroupId, savedPhoneDataResponse, isPrivateMode, privateContacts, contacts, activeContactId, localizeUi]);

  // Handler to run AI Data Generation
  const handleGeneratePhoneData = useCallback(async () => {
    if (!activeChatId) {
      toast.error(localizeUi("ui.chat.mochiosview.noActiveRoleplayChat"));
      return;
    }

    // Build messages using the active AI preset blocks and formatGuidesDraft.formatGuide.data
    let activeBlocks: Array<any> = DEFAULT_MOCHI_PRESET.blocks;
    if (promptPresetMode === "custom") {
      try {
        const parsed = JSON.parse(customPresetJsonDraft || DEFAULT_MOCHI_PRESET_JSON);
        if (Array.isArray(parsed?.blocks)) {
          activeBlocks = parsed.blocks;
        }
      } catch {
        activeBlocks = DEFAULT_MOCHI_PRESET.blocks;
      }
    }

    const dataGuideContent =
      formatGuidesDraft?.formatGuide?.data !== undefined
        ? formatGuidesDraft.formatGuide.data
        : DEFAULT_FORMAT_GUIDES.formatGuide.data;
    // Phone profile fields enrich ID cards; the persona's real name remains
    // the roleplay {{user}}, just as in SillyTavern.
    const personaName = activeLinkedPersona?.name?.trim() || activeChatData?.userName || "User";
    const screenName = profileNicknameDraft.trim() || personaName;

    // Only cards belonging to this roleplay may reach its data prompt.
    const chatCharIds = getChatCharacterIds(activeChatData);
    const relevantCharacters = (realCharacters as unknown as Character[]).filter((c) => {
      if (!c?.id) return false;
      if (chatCharIds.length > 0) return chatCharIds.includes(c.id);
      return false;
    });

    const effectiveCharList = relevantCharacters;

    // Expand ID Macro Cards marker
    const phoneCharacters = aiDataYamlDraft.trim() ? [
      ...(savedPhoneDataResponse?.phoneData?.characters || []),
      ...(savedPhoneDataResponse?.phoneData?.private_contacts || []),
    ] : [];
    const defaultFriendInfo = phoneCharacters.length ? phoneCharacters.map(formatFriendInfo).join("\n\n") : formatFriendInfo();
    const idMacroCardsContent = `User Information:\nName: ${personaName}\nScreen Name: ${screenName !== personaName && screenName ? screenName : personaName}\nBio: ${profileBioDraft.trim() || "Not set"}\n\n${defaultFriendInfo}`;

    // If YAML was cleared or empty, do NOT send old YAML to AI, and delete the saved file on server
    const trimmedYamlDraft = aiDataYamlDraft.trim();
    if (!trimmedYamlDraft && (savedPhoneDataResponse?.rawYaml || savedPhoneDataResponse?.phoneData)) {
      try {
        await deletePhoneDataMutation.mutateAsync({
          chatId: activeChatId,
          characterName: primaryRoleplayCharName,
          category: "data_generation",
        });
      } catch (err) {
        console.error("Failed to delete cleared Mochi OS data file:", err);
      }
    }

    const existingYaml = trimmedYamlDraft;

    try {
      const primaryCharName =
        parseCharacterMacroData(effectiveCharList[0])?.name ||
        (effectiveCharList[0]?.data as any)?.name ||
        primaryRoleplayCharName ||
        "Character";
      const userInputBlock = activeBlocks.find((block) => block.enabled !== false && (block.markerConfig?.type || block.identifier) === "user_input");
      const baseInput = userInputBlock?.content || "Generate complete phone_data YAML according to the format requirements.";
      const messages = await buildMochiPresetMessages({
        blocks: activeBlocks,
        characters: effectiveCharList,
        persona: activeLinkedPersona,
        userName: personaName,
        characterName: primaryCharName,
        userInput: aiDataUserRequest.trim() ? `User Request: ${aiDataUserRequest.trim()}\n\n${baseInput}` : baseInput,
        idMacroCards: idMacroCardsContent,
        formatGuides: buildMochiDataGenerationGuideBlock({ existingYaml, dataGuide: dataGuideContent }),
        historyConfig: formatGuidesDraft.historyConfig,
      });
      const res = await generatePhoneDataMutation.mutateAsync({
        chatId: activeChatId,
        messages,
        userPrompt: aiDataUserRequest.trim() || undefined,
        category: "data_generation",
        characterName: primaryCharName,
        userName: personaName,
      });

      if (res?.rawOutput) {
        setAiDataYamlDraft(res.rawOutput);
        await savePhoneDataMutation.mutateAsync({
          chatId: activeChatId,
          rawYaml: cleanAndExtractRawYaml(res.rawOutput),
          category: "data_generation",
          characterName: primaryCharName,
        });
        toast.success(localizeUi("ui.chat.mochiosview.phoneDataGenerated"));

        // Invalidate chat messages query so the Mochi OS log immediately appears in the roleplay chat
        if (activeChatId) {
          qc.invalidateQueries({ queryKey: chatKeys.messages(activeChatId) });
        }

        // If clock or weather AI-decide was on, auto-update clock/weather widgets based on generated response
        try {
          applyEnvironmentUpdate(res.rawOutput);
        } catch (autoErr) {
          console.error("Failed to auto-update clock or weather from AI generation:", autoErr);
        }
      }
    } catch (err: any) {
      console.error("Failed to generate Mochi OS data:", err);
      toast.error(err?.message || localizeUi("ui.chat.mochiosview.phoneDataFailed"));
    }
  }, [
    activeChatId,
    aiDataYamlDraft,
    savedPhoneDataResponse,
    promptPresetMode,
    customPresetJsonDraft,
    formatGuidesDraft,
    realCharacters,
    activeLinkedPersona,
    profileNicknameDraft,
    profileBioDraft,
    activeChatData,
    aiDataUserRequest,
    generatePhoneDataMutation,
    savePhoneDataMutation,
    deletePhoneDataMutation,
    qc,
    primaryRoleplayCharName,
    localizeUi,
    applyEnvironmentUpdate,
  ]);

  const getYamlExportFilename = useCallback(() => {
    const chatCharIds = getChatCharacterIds(activeChatData);
    const relevantCharacters = (realCharacters as unknown as Character[]).filter((c) => {
      if (!c?.id) return false;
      if (chatCharIds.length > 0) return chatCharIds.includes(c.id);
      return true;
    });
    const target = relevantCharacters[0] || (realCharacters as unknown as Character[])[0];
    const parsed = parseCharacterMacroData(target);
    const charName = parsed?.name || (target?.data as any)?.name || target?.comment || "Character";
    const roleplayName = getChatDisplayName(activeChatData) || "Roleplay";

    const d = new Date();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const year = d.getFullYear();
    const hours = two(d.getHours());
    const minutes = two(d.getMinutes());
    const dateFormatted = `${month}/${day}/${year}@${hours}:${minutes}`;

    return `${charName} (${roleplayName}) - Mochios ${dateFormatted}.yaml`;
  }, [activeChatData, realCharacters]);

  const handleDownloadYaml = useCallback(() => {
    const content = aiDataYamlDraft.trim();
    if (!content) return;
    const filename = getYamlExportFilename();
    const blob = new Blob([content], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [aiDataYamlDraft, getYamlExportFilename]);

  // Clear the profile fields the deleted document filled in. They are only ever
  // written from phone data, so leaving them would keep a deleted bio and handle
  // on screen and would feed them back into the next generation.
  const resetProfileDraftsFromPhoneData = useCallback(() => {
    setProfileUserIdDraft("");
    setProfileEmailDraft("");
    setProfileBioDraft("");
    setProfileNicknameDraft(activeLinkedPersona?.name ?? activeChatData?.userName ?? "");
  }, [activeLinkedPersona, activeChatData?.userName]);

  /**
   * Delete the saved phone data and everything it filled in.
   *
   * Reached by emptying the editor, which is the only signal available: the panel
   * and its controls disappear once the text is gone, so there is nothing left to
   * click. A guard on the previous value keeps a no-op re-render from firing it.
   */
  const handleErasePhoneDataYaml = useCallback(async () => {
    if (!activeChatId || deletingPhoneDataRef.current) return;
    deletingPhoneDataRef.current = true;
    try {
      await deletePhoneDataMutation.mutateAsync({
        chatId: activeChatId,
        characterName: primaryRoleplayCharName,
        category: "data_generation",
      });
      resetProfileDraftsFromPhoneData();
      setAiDataYamlDraft("");
      toast.success(localizeUi("ui.chat.mochiosview.phoneDataDeleted"));
      handleCloseAiDataModal();
    } catch (err: any) {
      console.error("Failed to delete Mochi OS data:", err);
      toast.error(err?.message || localizeUi("ui.chat.mochiosview.phoneDataFailed"));
    } finally {
      deletingPhoneDataRef.current = false;
    }
  }, [
    activeChatId,
    deletePhoneDataMutation,
    primaryRoleplayCharName,
    resetProfileDraftsFromPhoneData,
    localizeUi,
    handleCloseAiDataModal,
  ]);

  // Handler to apply / save user-confirmed YAML
  const handleSavePhoneDataYaml = useCallback(async () => {
    if (!activeChatId) {
      toast.error(localizeUi("ui.chat.mochiosview.noActiveRoleplayChat"));
      return;
    }
    if (!aiDataYamlDraft.trim()) {
      await handleErasePhoneDataYaml();
      return;
    }

    try {
      const chatCharIds = getChatCharacterIds(activeChatData);
      const relevantCharacters = (realCharacters as unknown as Character[]).filter((c) => {
        if (!c?.id) return false;
        if (chatCharIds.length > 0) return chatCharIds.includes(c.id);
        return true;
      });
      const target = relevantCharacters[0] || (realCharacters as unknown as Character[])[0];
      const parsed = parseCharacterMacroData(target);
      const primaryCharName = parsed?.name || (target?.data as any)?.name || primaryRoleplayCharName || "Character";

      const res = await savePhoneDataMutation.mutateAsync({
        chatId: activeChatId,
        rawYaml: cleanAndExtractRawYaml(aiDataYamlDraft.trim()),
        category: "data_generation",
        characterName: primaryCharName,
      });

      toast.success(localizeUi("ui.chat.mochiosview.phoneDataGenerated"));
      handleCloseAiDataModal();

      // Hydrate profile immediately
      if (res?.phoneData?.user) {
        if (res.phoneData.user.id) setProfileUserIdDraft(res.phoneData.user.id);
        if (res.phoneData.user.bio) setProfileBioDraft(res.phoneData.user.bio);
        if (res.phoneData.user.email) setProfileEmailDraft(res.phoneData.user.email);
        if (res.phoneData.user.nickname !== undefined) {
          setProfileNicknameDraft(res.phoneData.user.nickname);
        }
      }
    } catch (err: any) {
      console.error("Failed to save Mochi OS data:", err);
      toast.error(err?.message || localizeUi("ui.chat.mochiosview.phoneDataFailed"));
    }
  }, [
    activeChatId,
    activeChatData,
    realCharacters,
    aiDataYamlDraft,
    savePhoneDataMutation,
    handleErasePhoneDataYaml,
    primaryRoleplayCharName,
    activeLinkedPersona,
    handleCloseAiDataModal,
    localizeUi,
  ]);

  // Save changes to user profile into Phone Data YAML
  const handleSaveUserProfileToPhoneData = useCallback(
    async (patch: { nickname?: string; userId?: string; email?: string; bio?: string }) => {
      if (!activeChatId) return;
      try {
        const existingData: any = savedPhoneDataResponse?.phoneData ? { ...savedPhoneDataResponse.phoneData } : {};
        const currentUser = existingData.user ? { ...existingData.user } : {};
        if (patch.nickname !== undefined) currentUser.nickname = patch.nickname;
        if (patch.userId !== undefined) currentUser.id = patch.userId;
        if (patch.email !== undefined) currentUser.email = patch.email;
        if (patch.bio !== undefined) currentUser.bio = patch.bio;
        existingData.user = currentUser;

        const updatedYaml = yaml.stringify(existingData);
        setAiDataYamlDraft(updatedYaml);

        await savePhoneDataMutation.mutateAsync({
          chatId: activeChatId,
          rawYaml: updatedYaml,
          category: "data_generation",
          characterName: primaryRoleplayCharName,
        });
      } catch (err) {
        console.error("Failed to update user profile in phone data:", err);
      }
    },
    [activeChatId, primaryRoleplayCharName, savePhoneDataMutation, savedPhoneDataResponse],
  );

  // Save changes to character in People section into Phone Data YAML
  const handleSavePersonToPhoneData = useCallback(
    async (
      personId: string,
      fields: { name: string; contactname: string; socialhandle: string; email: string; onlineStyle: string },
    ) => {
      if (!activeChatId) return;
      try {
        const existingData: any = savedPhoneDataResponse?.phoneData ? { ...savedPhoneDataResponse.phoneData } : {};
        const chars: any[] = Array.isArray(existingData.characters) ? [...existingData.characters] : [];
        const idx = chars.findIndex((c) => (c.id || c.name) === personId);
        const contactnameVal = fields.contactname.trim();
        const effectiveDisplayName = contactnameVal || fields.name.trim();

        if (idx >= 0) {
          const oldChar = chars[idx];
          const newChar: any = {};
          // Preserve id first
          if (oldChar.id !== undefined) newChar.id = oldChar.id;
          // Contact display aliases stay separate from social-media handles.
          newChar.name = fields.name.trim();
          if (contactnameVal) {
            newChar.contactname = contactnameVal;
          }
          newChar.socialhandle = fields.socialhandle.trim();
          if (fields.email.trim()) {
            newChar.email = fields.email.trim();
          } else if (oldChar.email !== undefined) {
            // cleared
          }
          if (fields.onlineStyle.trim()) {
            newChar.onlineStyle = fields.onlineStyle.trim();
          }

          // Retain remaining fields (such as imageGen, bio, etc.) in their original order
          for (const key of Object.keys(oldChar)) {
            if (
              key === "id" ||
              key === "name" ||
              key === "contactname" ||
              key === "nickname" ||
              key === "socialhandle" ||
              key === "screenName" ||
              key === "screen_name" ||
              key === "email" ||
              key === "onlineStyle" ||
              key === "onlinestyle" ||
              key === "online_style"
            ) {
              continue;
            }
            newChar[key] = oldChar[key];
          }

          chars[idx] = newChar;
        }
        existingData.characters = chars;

        const updatedYaml = yaml.stringify(existingData);
        setAiDataYamlDraft(updatedYaml);

        await savePhoneDataMutation.mutateAsync({
          chatId: activeChatId,
          rawYaml: updatedYaml,
          category: "data_generation",
          characterName: primaryRoleplayCharName,
        });

        // Also update contact display name in active contacts/privateContacts map
        const updateContactDisplayName = (prev: MochiContactsMap) => {
          const matchKey = Object.keys(prev).find(
            (k) =>
              k.toLowerCase() === personId.toLowerCase() ||
              prev[k]?.name?.toLowerCase() === (fields.name || "").toLowerCase() ||
              (chars[idx]?.name && prev[k]?.name?.toLowerCase() === chars[idx].name.toLowerCase()),
          );
          if (matchKey && prev[matchKey]) {
            return {
              ...prev,
              [matchKey]: {
                ...prev[matchKey],
                name: effectiveDisplayName,
              },
            };
          }
          return prev;
        };
        setContacts(updateContactDisplayName);
        setPrivateContacts(updateContactDisplayName);

        setEditingPersonId(null);
        toast.success(localizeUi("ui.chat.mochiosview.save"));
      } catch (err: any) {
        console.error("Failed to update character in phone data:", err);
        toast.error(err?.message || localizeUi("ui.chat.mochiosview.phoneDataFailed"));
      }
    },
    [activeChatId, primaryRoleplayCharName, savePhoneDataMutation, savedPhoneDataResponse, localizeUi],
  );

  // Send text & trigger generation / execute slash commands
  const handleSendText = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed) return;
    setMsgInputText("");
    setReplyingToMochiMessage(null);
    setSlashCompletions([]);

    // Slash command check
    const matched = matchSlashCommand(trimmed, {
      mode: "conversation",
      availableCapabilityIds,
    });

    if (matched) {
      if (effectiveChatId) {
        const slashCtx: SlashCommandContext = {
          chatId: effectiveChatId,
          mode: "conversation",
          generate,
          createMessage: async (data: any) => {
            await api.post(`/chats/${effectiveChatId}/messages`, data);
            await qc.invalidateQueries({ queryKey: chatKeys.messages(effectiveChatId) });
          },
          invalidate: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
          characterNames: [],
          characters: [],
          latestAssistantMessageId: null,
          lastMessageRole: undefined,
          availableCapabilityIds,
        };
        try {
          const result = await matched.command.execute(matched.args, slashCtx);
          if (result.feedback) {
            setSlashFeedback(result.feedback);
          }
        } catch (err: any) {
          console.error("Slash command execution error:", err);
          setSlashFeedback(err?.message || "Command failed");
        }
        return;
      }
    }

    // A transfer marker becomes a real transfer bubble rather than text that
    // mentions one, so the card renders immediately and the archive keeps it.
    // This covers sending, and the accept/reject answers, which are markers of
    // the same shape. Answering while composing a reply stays a quote.
    const transferMatch = trimmed.match(/^\[Transfer(-Accepted|-Rejected)?:\s*(\S+)\s*(?:·\s*(.*))?\]$/);
    if (transferMatch && !replyingToMochiMessage) {
      const outcome =
        transferMatch[1] === "-Accepted" ? "accepted" : transferMatch[1] === "-Rejected" ? "rejected" : null;
      const type = outcome ? `transfer-${outcome}` : "transfer";
      pushMessageToCurrentContact({
        me: 1,
        type,
        rawType: type,
        rawItem: {
          // Keep the authored symbol so the card shows the same figure the
          // user composed, matching the marker they sent.
          amt: transferMatch[2],
          ...(transferMatch[3]?.trim() && !outcome ? { note: transferMatch[3].trim() } : {}),
        },
      });
      return;
    }

    // A saved sticker token sends an actual sticker bubble, not unrendered text.
    const selectedSticker = /^:([^:]+):$/.exec(trimmed)?.[1];
    // Add the message to the active contact / group, BUT DO NOT GENERATE AI
    const userMsgItem: MochiMessage = replyingToMochiMessage
      ? {
          me: 1,
          type: "quote",
          rawType: "quote",
          text: trimmed,
          rawItem: {
            quote: {
              name: replyingToMochiMessage.author,
              t: "text",
              c: replyingToMochiMessage.text,
            },
          },
        }
      : {
          me: 1,
          type: selectedSticker && conversationStickerMap.has(selectedSticker) ? "sticker" : "text",
          text: selectedSticker && conversationStickerMap.has(selectedSticker) ? selectedSticker : trimmed,
        };

    // Check if we already have an ongoing chat
    if (effectiveChatId) {
      // Only inject slash-cmd text to global message stream if we want it visible there,
      // but for MochiOS we just push to local contact state.
      pushMessageToCurrentContact(userMsgItem);
    } else {
      pushMessageToCurrentContact(userMsgItem);
    }
  };

  const handleStopMochiAiGeneration = useCallback(() => {
    stopEngineGenerate();
    if (mochiGenerationAbortRef.current) {
      mochiGenerationAbortRef.current.abort();
      mochiGenerationAbortRef.current = null;
    }
    const onFailure = mochiActiveOnFailureRef.current;
    mochiActiveOnFailureRef.current = undefined;
    if (onFailure) {
      void onFailure();
    }
    const onSettled = mochiActiveOnSettledRef.current;
    mochiActiveOnSettledRef.current = undefined;
    onSettled?.();
    setIsMochiAiGenerating(false);
  }, [stopEngineGenerate]);

  // Dedicated AI Generation Trigger (via Refresh button or Regeneration)
  const handleTriggerAiGeneration = async (
    overrideUserMsgs?: MochiMessage[],
    historyOverride?: MochiMessage[],
    onFailure?: () => Promise<void>,
    excludedRoleplayMessageIds: string[] = [],
    onSettled?: () => void,
    appendSwipeToMessageId?: string,
    deleteRoleplayMessageIdsOnSuccess: string[] = [],
  ) => {
    mochiActiveOnFailureRef.current = onFailure;
    mochiActiveOnSettledRef.current = onSettled;

    // Phone replies require a selected SillyTavern chat, not a simulated fallback.
    if (!activeChatId) {
      toast.error("Select a SillyTavern chat before generating phone replies.");
      mochiActiveOnFailureRef.current = undefined;
      mochiActiveOnSettledRef.current = undefined;
      await onFailure?.();
      onSettled?.();
      return;
    }

    // Build the prompt for whichever thread is on screen: a one-on-one chat with
    // a character, or a group chat whose members talk with the user and each other.
    const targetContactObj = currentContactsMap[activeThreadId];

    // Find the matching character in phone_data to distinguish real character name from user's custom contact name
    const genCharacters: MochiOsCharacterData[] = [
      ...(savedPhoneDataResponse?.phoneData?.characters || []),
      ...(savedPhoneDataResponse?.phoneData?.private_contacts || []),
    ];
    const matchedGenChar = isGroupThread
      ? undefined
      : genCharacters.find((p) => {
          if (!p) return false;
          const pId = (p.id || "").toLowerCase();
          const pName = (p.name || "").toLowerCase();
          const pContact = (p.contactname || "").toLowerCase();
          const pNick = mochiSocialHandle(p).toLowerCase();
          const tId = activeThreadId.toLowerCase();
          const cName = (targetContactObj?.name || "").toLowerCase();
          return (
            pId === tId ||
            pName === tId ||
            pContact === tId ||
            pNick === tId ||
            pId === cName ||
            pName === cName ||
            pContact === cName ||
            pNick === cName
          );
        });

    // Real character name (e.g. "Seijuro Akashi") from data generation yaml
    const targetCharName = isGroupThread
      ? groupThreadName
      : matchedGenChar?.name?.trim() ||
        primaryRoleplayCharName ||
        (targetContactObj?.name !== "Contact" && targetContactObj?.name !== "mochi" ? targetContactObj?.name : "") ||
        "Character";

    // User's custom contact name (e.g. "Do not answer")
    const targetContactName = isGroupThread
      ? groupThreadName
      : targetContactObj?.name || matchedGenChar?.contactname?.trim() || targetCharName;

    // Collect trailing un-replied user messages or use override user messages from regeneration
    const contactMessages = historyOverride || targetContactObj?.msgs || [];
    const pendingUserMsgs: MochiMessage[] = [];
    if (overrideUserMsgs && overrideUserMsgs.length > 0) {
      pendingUserMsgs.push(...overrideUserMsgs);
    } else {
      for (let i = contactMessages.length - 1; i >= 0; i--) {
        if (contactMessages[i].me === 1) {
          pendingUserMsgs.unshift(contactMessages[i]);
        } else {
          break; // Stop at the first AI message
        }
      }
    }

    // With nothing typed, the user is asking for another reply, not saying
    // anything. `continuationOnly` keeps that instruction out of the archive.
    const continuationOnly = pendingUserMsgs.length === 0;
    const combinedUserPrompt = continuationOnly
      ? isGroupThread
        ? buildMochiGroupContinuationPrompt(targetCharName, activeGroupMemberNames)
        : buildMochiContinuationPrompt(targetCharName)
      : pendingUserMsgs.map((m) => formatUserMsgForAi(m)).join("\n");

    if (mochiGenerationAbortRef.current) {
      mochiGenerationAbortRef.current.abort();
    }
    const abortController = new AbortController();
    mochiGenerationAbortRef.current = abortController;
    setIsMochiAiGenerating(true);

    try {
      // Active preset blocks
      let activeBlocks: Array<any> = DEFAULT_MOCHI_PRESET.blocks;
      if (promptPresetMode === "custom") {
        try {
          const parsed = JSON.parse(customPresetJsonDraft || DEFAULT_MOCHI_PRESET_JSON);
          if (Array.isArray(parsed?.blocks)) {
            activeBlocks = parsed.blocks;
          }
        } catch {
          activeBlocks = DEFAULT_MOCHI_PRESET.blocks;
        }
      }

      // Persona & User macro
      const personaName = activeLinkedPersona?.name?.trim() || activeChatData?.userName || "User";
      const screenName = profileNicknameDraft.trim() || personaName;

      // Environment Time/Date/Weather instructions
      const envLines: string[] = [];
      if (clockMode === "custom") {
        const chosenDate = new Date(Date.now() + clockOffset);
        const dateStr = chosenDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        const timeStr = fmtTime(chosenDate, isHour12);
        envLines.push(`Date: "${clockAiDecide ? "" : dateStr}"`);
        envLines.push(`Time: "${clockAiDecide ? "" : timeStr}"`);
      } else {
        envLines.push(`Timezone: "${clockAiDecide ? "" : clockTz}"`);
      }
      envLines.push(`Location: "${wxAiDecide ? "" : wxPlace || ""}"`);
      const currentDispTemp = tempUnit === "F" ? `${Math.round((wxTemp * 9) / 5 + 32)}°F` : `${Math.round(wxTemp)}°C`;
      envLines.push(`Temperature: "${wxAiDecide ? "" : currentDispTemp}"`);
      if (wxAiDecide) {
        envLines.push(
          `Weather Condition: "Sunny, Partly Cloudy, Cloudy, Foggy, Drizzle, Rainy, Showers, Snowy, Thunderstorm, or write a Custom weather condition."`,
        );
      } else {
        envLines.push(`Weather Condition: "${wxCondition}"`);
      }

      const timeDateWeatherTemplate =
        formatGuidesDraft?.formatGuide?.timeDateWeather !== undefined
          ? formatGuidesDraft.formatGuide.timeDateWeather
          : DEFAULT_FORMAT_GUIDES.formatGuide.timeDateWeather;
      const timeDateWeatherBlock = buildMochiTimeDateWeatherBlock({
        template: timeDateWeatherTemplate,
        envLines,
        hasConfiguredSettings: !clockAiDecide || !wxAiDecide,
      });

      // Format Guide for private chat (or group chat if in a group), followed by time/date/weather
      const chatGuideTemplate = activeGroupId
        ? formatGuidesDraft?.formatGuide?.groupChat || DEFAULT_FORMAT_GUIDES.formatGuide.groupChat
        : formatGuidesDraft?.formatGuide?.privateChat || DEFAULT_FORMAT_GUIDES.formatGuide.privateChat;
      const stickerNames = conversationStickers.map((sticker) => sticker.name);
      const stickerLibraryBlock = `## Sticker Library\n\nBelow is a list of available sticker names. When sending a sticker message, simply enter the sticker name:\n\n### General Stickers\n${stickerNames.length ? stickerNames.join(", ") : "(No stickers available)"}\n\nRules of Use：\n- Sticker Messages c Just enter the name of the sticker in the field.\n- The system will automatically match the corresponding image based on the names.\n- You may only use the stickers listed above; do not use any stickers not included in the list.\n- Try not to reuse stickers you've used in past chats.\n\n## Output Format Requirements\n\n`;

      // Fill the thread-name placeholders from the selected Mochi contact or
      // group, never from the roleplay chat's primary-character fallback.
      // {{Other party's name}} in <privatechat_history target="{{Other party's name}}" type="private">
      // must be the character's real name from data generation yaml (targetCharName).
      // The private output has no contactname field. Read display aliases from
      // phone_data instead; keep placeholder expansion for other legacy guides.
      const chatGuideForRequest = (isGroupThread ? chatGuideTemplate : normalizeMochiPrivateChatGuide(chatGuideTemplate))
        .replace(
          /<privatechat_history\s+target="[^"]*"\s+type="private">/gi,
          `<privatechat_history target="${targetCharName}" type="private">`,
        )
        .replace(/\{\{Other party's name\}\}/gi, () => targetCharName)
        .replace(/\{\{contactname\}\}/gi, () => targetContactName)
        .replace(/\{\{groupchatname\}\}/gi, () => targetCharName)
        .replace(/\{\{name\}\}/gi, () => targetContactName);
      const formatGuideBlock = `${stickerLibraryBlock}${chatGuideForRequest}\n\n${timeDateWeatherBlock}`;

      // Character info
      const chatCharIds = getChatCharacterIds(activeChatData);
      const relevantCharacters = (realCharacters as unknown as Character[]).filter((c) => {
        if (!c?.id) return false;
        return chatCharIds.includes(c.id);
      });
      const effectiveCharList = relevantCharacters;

      // Match the specific character if 1-on-1. A group has no single counterpart,
      // so the roster decides which characters are described: sending the whole
      // chat roster would let members who are not in this group speak in it.
      const rosterKeys = activeGroupMemberNames.map((name) => name.toLowerCase());
      const groupMemberChars = rosterKeys.length
        ? effectiveCharList.filter((c) => {
            if (!c) return false;
            const parsed = parseCharacterMacroData(c);
            const name = (parsed?.name || (c.data as any)?.name || c.comment || "").toLowerCase();
            const nickname = mochiSocialHandle(c.data as any).toLowerCase();
            return rosterKeys.includes(name) || rosterKeys.includes(nickname);
          })
        : [];
      const matchedChar = isGroupThread
        ? undefined
        : effectiveCharList.find((c) => {
            if (!c) return false;
            if (c.id === activeThreadId) return true;
            const parsed = parseCharacterMacroData(c);
            const name = parsed?.name || (c.data as any)?.name || c.comment || "";
            return name.toLowerCase() === targetCharName.toLowerCase();
          });
      const targetCharList = isGroupThread
        ? groupMemberChars.length > 0
          ? groupMemberChars
          : effectiveCharList
        : matchedChar
          ? [matchedChar]
          : effectiveCharList;

      // Format Friend Information for ID Macro Cards depending on private vs group chat
      let friendInfoContent = "";
      let parsedPhoneData = savedPhoneDataResponse?.phoneData;
      if (!parsedPhoneData && aiDataYamlDraft.trim()) {
        try {
          const parsed = yaml.parse(extractPhoneDataEditorYaml(aiDataYamlDraft));
          parsedPhoneData = parsed?.phone_data || parsed;
        } catch {
          // ignore yaml parse errors
        }
      }

      const genCharacters: MochiOsCharacterData[] = [
        ...(Array.isArray(parsedPhoneData?.characters) ? parsedPhoneData.characters : []),
        ...(Array.isArray(parsedPhoneData?.private_contacts) ? parsedPhoneData.private_contacts : []),
      ];

      if (isGroupThread) {
        // Group chat: describe the members on this group's roster, so the model
        // knows who may speak and what their messaging style is.
        const allMemberNames = activeGroupMemberNames.map((name) => name.toLowerCase());

        const matchedGroupChars = genCharacters.filter((p) => {
          if (!p) return false;
          if (allMemberNames.length === 0) return true;
          const pId = (p.id || "").toLowerCase();
          const pName = (p.name || "").toLowerCase();
          const pNick = mochiSocialHandle(p).toLowerCase();
          return allMemberNames.includes(pId) || allMemberNames.includes(pName) || allMemberNames.includes(pNick);
        });

        const groupCharsToFormat = matchedGroupChars.length > 0 ? matchedGroupChars : genCharacters;
        const groupInfo = groupCharsToFormat.length
          ? groupCharsToFormat.map((c) => formatFriendInfo(c)).join("\n\n")
          : formatFriendInfo();
        // A group roster is the model's licence to speak for several people, so
        // the group name and its member list are stated with the ID cards.
        friendInfoContent = [`Group Chat: ${groupThreadName}`, `Members: ${allMemberNames.join(", ")}`, groupInfo]
          .filter(Boolean)
          .join("\n\n");
      } else {
        // Private chat: 1-on-1 with character
        friendInfoContent = formatFriendInfo(
          matchedGenChar || {
            name: targetCharName !== "Character" && targetCharName !== "mochi" ? targetCharName : undefined,
          },
        );
      }

      const idMacroCardsContent = `User Information:\nName: ${personaName}\nScreen Name: ${screenName !== personaName && screenName ? screenName : personaName}\nBio: ${profileBioDraft.trim() || "Not set"}\n\n${friendInfoContent}`;

      // One shared ST-style expansion path for every generation category. The
      // history marker inserts real chronological role messages, once each.
      const messages = await buildMochiPresetMessages({
        blocks: activeBlocks,
        characters: targetCharList,
        persona: activeLinkedPersona,
        userName: personaName,
        characterName: targetCharName,
        userInput: combinedUserPrompt,
        idMacroCards: idMacroCardsContent,
        formatGuides: formatGuideBlock,
        historyConfig: formatGuidesDraft.historyConfig,
        excludedMessageIds: excludedRoleplayMessageIds,
      });

      const res = await generatePhoneDataMutation.mutateAsync({
        chatId: activeChatId,
        messages,
        // A group thread is archived as its own record type, so it is generated
        // under its own category instead of being flattened into a private chat.
        category: isGroupThread ? "group_chats" : "private_chats",
        characterName: targetCharName,
        contactName: targetContactName,
        userName: userScreenName,
        userPrompt: combinedUserPrompt,
        userMessages: pendingUserMsgs,
        continuationOnly,
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) {
        return;
      }

      if (!res?.rawOutput) {
        throw new Error("Mochi OS returned no response");
      }

      if (deleteRoleplayMessageIdsOnSuccess.length > 0) {
        await Promise.all(
          deleteRoleplayMessageIdsOnSuccess.map((id) => api.delete(`/chats/${activeChatId}/messages/${id}`)),
        );
      }

      const taggedTurn = res.rawOutput;
      let savedTurn: Message;
      // Regeneration explicitly names its record. A normal send/continuation
      // always appends; matching history ids here would overwrite an older turn.
      if (appendSwipeToMessageId) {
        savedTurn = await api.post<Message>(`/chats/${activeChatId}/messages/${appendSwipeToMessageId}/swipes`, {
          content: taggedTurn,
        });
      } else {
        savedTurn = await api.post<Message>(`/chats/${activeChatId}/messages`, {
          role: "assistant",
          // Group authors live inside the transcript, never on an unrelated card.
          characterId: isGroupThread ? null : getChatCharacterIds(activeChatData).find((id) => {
                  const character = characterLookup.get(id);
                  const characterData = character ? parseCharacterMacroData(character) : null;
                  return (
                    (
                      characterData?.name ||
                      (character?.data as any)?.name ||
                      character?.comment ||
                      ""
                    ).toLowerCase() === targetCharName.toLowerCase()
                  );
                }) || null,
          content: taggedTurn,
        });
      }

      if (!savedTurn?.id) throw new Error("The connected roleplay message could not be saved.");
      if (res.rawOutput) {
        // Extract latest environment block if present to preserve as metadata and update clock/weather widgets
        const allEnvMatches = Array.from(taggedTurn.matchAll(/<environment>([\s\S]*?)<\/environment>/gi));
        const envMatch = allEnvMatches.length > 0 ? allEnvMatches[allEnvMatches.length - 1] : null;
        if (envMatch) {
          lastEnvironmentYamlRef.current[activeThreadId] = envMatch[0].trim();
          applyEnvironmentUpdate(envMatch[0]);
        }

        const record = parseChatHistoryBlocks(taggedTurn, screenName, { recordType: activeRecordType })[0];
        if (!record?.messages.some((message) => message.me !== 1)) throw new Error("Mochi OS returned no chat messages");
        const answeredIds = new Set(pendingUserMsgs.map((message) => message.id));
        pendingUserMsgsQueueRef.current[activeThreadId] = (pendingUserMsgsQueueRef.current[activeThreadId] || [])
          .filter((message) => !answeredIds.has(message.id));
        delete regeneratingUserMsgsRef.current[activeThreadId];
        const canonicalMsgs: MochiMessage[] = record.messages.map((message, itemIndex) => ({
          ...message, id: mochiRoleplayBubbleId(savedTurn.id, 0, itemIndex),
          t: message.time || record.time, d: message.date || record.date,
        }));
        const historyBefore = (historyOverride || targetContactObj?.msgs || []).filter((message) => !answeredIds.has(message.id));
        const setter = isPrivateMode ? setPrivateContacts : setContacts;
        setter((prev) => {
          const contact = prev[activeThreadId] || targetContactObj;
          if (!contact) return prev;
          // Use the saved canonical turn, not a second append racing the host's
          // hydration. Keep new user bubbles queued while this reply was pending.
          const knownIds = new Set([...historyBefore, ...canonicalMsgs].map((message) => message.id));
          const newerInputs = (pendingUserMsgsQueueRef.current[activeThreadId] || []).filter((message) => !knownIds.has(message.id));
          const msgs = [...historyBefore, ...canonicalMsgs, ...newerInputs];
          return { ...prev, [activeThreadId]: { ...contact, msgs, preview: mochiMessagePreview(msgs.at(-1)) } };
        });
        await qc.invalidateQueries({ queryKey: chatKeys.messages(activeChatId) });
      }
    } catch (err: any) {
      const isAborted =
        abortController.signal.aborted || (err instanceof DOMException && err.name === "AbortError");
      if (!isAborted) {
        console.error("Mochi OS chat AI generation error:", err);
        toast.error(err?.message || localizeUi("ui.chat.mochiosview.phoneReplyFailed"));
      }
      const activeFailure = mochiActiveOnFailureRef.current;
      mochiActiveOnFailureRef.current = undefined;
      if (activeFailure) {
        await activeFailure();
      } else if (onFailure) {
        await onFailure();
      }
    } finally {
      if (mochiGenerationAbortRef.current === abortController) {
        mochiGenerationAbortRef.current = null;
      }
      mochiActiveOnFailureRef.current = undefined;
      const activeSettled = mochiActiveOnSettledRef.current;
      mochiActiveOnSettledRef.current = undefined;
      setIsMochiAiGenerating(false);
      if (activeSettled) {
        activeSettled();
      } else {
        onSettled?.();
      }
    }
  };
  const handleTriggerAiGenerationRef = useRef(handleTriggerAiGeneration);
  handleTriggerAiGenerationRef.current = handleTriggerAiGeneration;

  const handleSendVoiceNote = async () => {
    const durStr = recDur > 0 ? fmtDur(recDur) : "0:01";
    setVoiceModalOpen(false);
    resetVoice();

    if (effectiveChatId) {
      try {
        await generate({
          chatId: effectiveChatId,
          connectionId: null,
          userMessage: `[🎤 Voice note: ${durStr}]`,
          ...(promptPresetMode === "engine" && selectedEnginePresetId ? { presetId: selectedEnginePresetId } : {}),
        });
      } catch (err) {
        console.error("Mochi OS voice note generation error:", err);
      }
    } else {
      await handleSendText(`[🎤 Voice note: ${durStr}]`);
    }
  };

  const handleSendTransfer = async () => {
    // Accept only a plain positive amount; a transfer with a free-form body
    // would be archived as an amount the model then has to guess at.
    const amount = Number(transferAmount.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const note = transferNote.trim();
    const marker = formatMochiTransferMarkerForAi(
      "transfer",
      { amt: amount.toFixed(2), ...(note ? { note } : {}) },
      currency,
    );

    setTransferModalOpen(false);
    setTransferAmount("");
    setTransferNote("");

    if (effectiveChatId) {
      try {
        await generate({
          chatId: effectiveChatId,
          connectionId: null,
          userMessage: marker,
          ...(promptPresetMode === "engine" && selectedEnginePresetId ? { presetId: selectedEnginePresetId } : {}),
        });
      } catch (err) {
        console.error("Mochi OS transfer generation error:", err);
      }
    } else {
      await handleSendText(marker);
    }
  };

  // Contacts for active mode
  const currentActiveContact = selectMochiThreadContact(currentContactsMap, activeThreadId);
  // Index of the incoming transfer still waiting on an answer, if any.
  const pendingTransferIdx = useMemo(
    () => findPendingMochiTransfer(currentActiveContact?.msgs ?? []),
    [currentActiveContact?.msgs],
  );

  /** Answer a pending incoming transfer, restating the amount it settles. */
  const handleAnswerTransfer = async (outcome: "accepted" | "rejected") => {
    const pending = pendingTransferIdx === null ? undefined : currentActiveContact?.msgs?.[pendingTransferIdx];
    const amount = formatMochiTransferAmount(pending?.rawItem);
    if (!pending || !amount) return;
    const type = outcome === "accepted" ? MOCHI_TRANSFER_ACCEPTED_TYPE : MOCHI_TRANSFER_REJECTED_TYPE;
    // Keep the original card's symbol rather than re-currencying the answer, so
    // accepting a ¥ transfer does not answer in a different figure.
    await handleSendText(
      formatMochiTransferMarkerForAi(type, { amt: formatMochiTransferDisplay(pending?.rawItem, currency) }),
    );
  };
  const activeCharacterColor = currentActiveContact?.name
    ? getMochiCharacterColor(currentActiveContact.name)
    : currentActiveContact?.color || "var(--acc)";

  // Auto-scroll chat body
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [currentActiveContact?.msgs, realChatMessages.length, streamBuffer, isChatGenerating]);

  // Calendar builder helper
  const calDays = useMemo(() => {
    const y = calView.getFullYear();
    const m = calView.getMonth();
    const firstDayIndex = new Date(y, m, 1).getDay();
    const totalDays = new Date(y, m + 1, 0).getDate();
    return { firstDayIndex, totalDays, y, m };
  }, [calView]);

  // Combined scope classes
  const scopeClasses = [
    "mochi-scope",
    "w-full",
    "h-full",
    "relative",
    // `clip`, not `hidden`: `overflow: hidden` still makes this a scroll container, so focusing
    // an off-centre control (the dock's Settings button) scrolled the desktop sideways and dragged
    // every overlay inside it off the left edge. `clip` clips without ever scrolling.
    "overflow-clip",
    `theme-${theme}`,
    colorPreset ? `color-${colorPreset}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const customColorHex = useMemo(() => rgbToHex(customRgb.r, customRgb.g, customRgb.b), [customRgb]);

  const resolvedTheme = useMochiThemeMode(theme);

  const customColorTokens = useMemo(
    () => (colorPreset === "custom" ? buildMochiCustomTokens(customColorHex, resolvedTheme) : null),
    [colorPreset, customColorHex, resolvedTheme],
  );

  const handleCustomColorChange = useCallback(
    (value: string) => {
      const normalized = normalizeHexColor(value);
      if (!normalized) return;
      const next = {
        r: Number.parseInt(normalized.slice(1, 3), 16),
        g: Number.parseInt(normalized.slice(3, 5), 16),
        b: Number.parseInt(normalized.slice(5, 7), 16),
      };
      setCustomRgb(next);
      saveSettings({ customRgb: next });
    },
    [saveSettings],
  );

  return (
    <div
      className={scopeClasses}
      style={{
        ...((customColorTokens ?? {}) as React.CSSProperties),
      }}
    >
      <div
        className="screen"
        onClick={() => {
          // Tapping the wallpaper is the standard way out of homescreen edit
          // mode, so a long press can never leave the grid locked.
          if (isAppEditingMode) setIsAppEditingMode(false);
        }}
      >
        {/* Status Bar */}
        <div className="status">
          <span className="right">
            {/* Cellular */}
            <svg width="20" height="16" viewBox="0 0 20 16" fill="#fff">
              <rect x="0" y="10" width="3.5" height="6" rx="1" />
              <rect x="5.5" y="7" width="3.5" height="9" rx="1" />
              <rect x="11" y="4" width="3.5" height="12" rx="1" />
              <rect x="16.5" y="0" width="3.5" height="16" rx="1" />
            </svg>
            {/* Wifi */}
            <svg
              width="22"
              height="16"
              viewBox="0 0 24 18"
              fill="none"
              stroke="#fff"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <path d="M3 6a13 13 0 0 1 18 0" />
              <path d="M6.5 9.5a8.5 8.5 0 0 1 11 0" />
              <path d="M10 13a4 4 0 0 1 4 0" />
              <circle cx="12" cy="15.5" r="1.6" fill="#fff" stroke="none" />
            </svg>
            {/* Battery */}
            <svg width="26" height="14" viewBox="0 0 26 14">
              <rect x="1" y="1" width="21" height="12" rx="3.5" fill="none" stroke="#fff" strokeWidth="1.6" />
              <rect x="3" y="3" width="14" height="8" rx="2" fill="#fff" />
              <rect x="23.5" y="4.5" width="2.5" height="5" rx="1.2" fill="#fff" />
            </svg>
          </span>
        </div>

        {/* Top Actions: Universe & Return buttons */}
        <div className="universe-bar">
          <button
            type="button"
            className="universe-btn"
            title={localizeUi("ui.chat.mochiosview.universe")}
            onClick={() => {
              // Open Universe feature / exploration
              alert("Entering the Universe… ✨");
            }}
          >
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>{localizeUi("ui.chat.mochiosview.universe")}</span>
          </button>
        </div>

        {/* Widgets: Clock & Weather */}
        <div className="widgets">
          <button
            type="button"
            className="widget"
            title={localizeUi("ui.chat.mochiosview.clockSettings")}
            onClick={handleOpenClockSettings}
          >
            <span className="big">{liveTime}</span>
            <span className="sub">
              {localizeUi("ui.agents.featureagentdetailhost.value1Value2", {
                value1: liveDateStr,
                value2: liveWeekday,
              })}
            </span>
          </button>
          <button
            type="button"
            className="widget"
            title={localizeUi("ui.chat.mochiosview.weatherSettings")}
            onClick={() => {
              setCustomWxLoc(wxPlace);
              const displayTemp = tempUnit === "F" ? Math.round((wxTemp * 9) / 5 + 32) : Math.round(wxTemp * 10) / 10;
              setCustomWxTemp(String(displayTemp));
              const known = [
                "Sunny",
                "Partly Cloudy",
                "Cloudy",
                "Foggy",
                "Drizzle",
                "Rainy",
                "Showers",
                "Snowy",
                "Thunderstorm",
              ];
              if (known.includes(wxCondition)) {
                setCustomWxCondChoice(wxCondition);
                setCustomWxCondText("");
              } else {
                setCustomWxCondChoice("__custom");
                setCustomWxCondText(wxCondition);
              }
              setWxErr("");
              setWxModalOpen(true);
            }}
          >
            <span className="big">{formattedWx.big}</span>
            <span className="sub">{formattedWx.sub}</span>
          </button>
        </div>

        {/* Mascots */}
        <div className="mochi-wallpaper" aria-hidden="true">
          <MascotRabbit1 className="mascot m1" />
          <MascotRabbit2 className="mascot m2" />
        </div>

        {/* Edit-mode Done button placed just above the apps grid */}
        {isAppEditingMode && (
          <div className="app-editing-done-bar">
            <button
              type="button"
              className="app-editing-done-btn"
              onClick={(e) => {
                e.stopPropagation();
                setIsAppEditingMode(false);
              }}
            >
              {localizeUi("ui.chat.chatcharacterdropoptions.done")}
            </button>
          </div>
        )}

        {/* App Grid */}
        <div className={`apps ${isAppEditingMode ? "is-editing" : ""}`}>
          {homescreenAppOrder.map((appId, index) => {
            const app = getMochiHomeApp(appId);
            if (!app) return null;
            const isDragging = draggingAppIndex === index;
            const isDragOver = dragOverAppIndex === index;

            return (
              <button
                key={appId}
                type="button"
                className={`app ${isDragging ? "is-dragging" : ""} ${isDragOver ? "drag-over" : ""}`}
                draggable={isAppEditingMode}
                aria-label={localizeUi(app.labelKey)}
                onPointerDown={handleAppPointerDown}
                onPointerMove={handleAppPointerMove}
                onPointerUp={handleAppPointerUpOrLeave}
                onPointerCancel={handleAppPointerUpOrLeave}
                onPointerLeave={handleAppPointerUpOrLeave}
                onDragStart={(e) => handleAppDragStart(index, e)}
                onDragOver={(e) => handleAppDragOver(index, e)}
                onDrop={(e) => handleAppDrop(index, e)}
                onDragEnd={handleAppDragEnd}
                onClick={(e) => handleAppClick(appId, e)}
              >
                {isAppEditingMode && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={localizeUi("ui.characters.characterclipcard.deleteValue1", {
                      value1: localizeUi(app.labelKey),
                    })}
                    className="app-delete-btn"
                    onClick={(e) => handleDeleteApp(appId, e)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDeleteApp(appId, e as unknown as React.MouseEvent);
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </span>
                )}
                <span className="tile">{app.icon}</span>
                <span className="label">{localizeUi(app.labelKey)}</span>
              </button>
            );
          })}
        </div>

        {/* Dock */}
        <div className="dock">
          <button type="button" className="app">
            <span className="tile">
              <svg viewBox="0 0 24 24">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </span>
            <span className="label">{localizeUi("ui.chat.mochiosview.phone")}</span>
          </button>

          <button type="button" className="app">
            <span className="tile">
              <svg viewBox="0 0 24 24">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </span>
            <span className="label">{localizeUi("ui.chat.mochiosview.mail")}</span>
          </button>

          <button
            type="button"
            className="app"
            onClick={() => {
              if (isAppEditingMode) return;
              setAppStoreOpen(true);
            }}
          >
            <span className="tile">
              <svg viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </span>
            <span className="label">{localizeUi("ui.chat.mochiosview.appStore")}</span>
          </button>

          <button type="button" className="app" onClick={() => setSettingsModalOpen(true)}>
            <span className="tile">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </span>
            <span className="label">{localizeUi("navigation.topbar.settings")}</span>
          </button>
        </div>
      </div>

      {/* ================= MESSAGES APP WINDOW ================= */}
      <div className={`app-window ${messagesAppOpen ? "open" : ""} ${inChatView ? "chat" : ""}`}>
        {/* LIST VIEW */}
        <div className="mview" id="listView">
          <div className="m-head">
            <button
              type="button"
              className="icon-btn"
              title={localizeUi("ui.chat.mochiosview.backToHome")}
              onClick={() => {
                handleExitChatView();
                setMessagesAppOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </button>
            <h2>
              {activeTab === "chats"
                ? localizeUi("navigation.common.chats")
                : activeTab === "calls"
                  ? localizeUi("ui.chat.mochiosview.calls")
                  : activeTab === "people"
                    ? localizeUi("ui.chat.mochiosview.people")
                    : localizeUi("chat.settingsProfile.label")}
            </h2>
            {activeTab === "people" && (
              <button
                type="button"
                className="icon-btn"
                title={localizeUi("ui.chat.mochiosview.addContact")}
                onClick={() => alert("Add new contact feature coming soon!")}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" />
                  <line x1="23" y1="11" x2="17" y2="11" />
                </svg>
              </button>
            )}
            {activeTab === "profile" && (
              <button
                type="button"
                className="icon-btn"
                title={localizeUi("ui.chat.mochiosview.generateData")}
                onClick={handleOpenAiDataModal}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                  <path d="M5 3v4" />
                  <path d="M19 17v4" />
                  <path d="M3 5h4" />
                  <path d="M17 19h4" />
                </svg>
              </button>
            )}
            {activeTab === "chats" && (
              <button
                type="button"
                className={`icon-btn ${isPrivateMode ? "active" : ""}`}
                id="privateBtn"
                title={localizeUi("ui.chat.mochiosview.private")}
                onClick={() => setIsPrivateMode((p) => !p)}
              >
                <svg id="privateIcon" viewBox="0 0 24 24">
                  <path className="eye-shape" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle className="eye-pupil" cx="12" cy="12" r="3" />
                  <line className="eye-slash" x1="2" y1="22" x2="22" y2="2" />
                </svg>
              </button>
            )}
          </div>

          {activeTab === "chats" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
              }}
            >
              <div className="m-search">
                <svg viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder={localizeUi("ui.noodle.noodlehome.searchNoodle")}
                  value={chatSearchText}
                  onChange={(e) => setChatSearchText(e.target.value)}
                  autoComplete="off"
                />
              </div>

              {/* Stories */}
              <div className="stories">
                <button
                  type="button"
                  className="story add"
                  onClick={() => {
                    setActiveTab("people");
                  }}
                  title={localizeUi("ui.chat.mochiosview.newChat")}
                >
                  <span className="s-ava">+</span>
                  <span className="s-name">{localizeUi("ui.chat.mochiosview.yourStory")}</span>
                </button>
              </div>

              {/* Conversation List: Generated Group Chats + Active Conversations */}
              <div className="convo-list">
                {/* 1) Generated Group Chats */}
                {savedPhoneDataResponse?.phoneData?.groups &&
                  (savedPhoneDataResponse.phoneData.groups as MochiOsGroupData[])
                    .filter(
                      (g: MochiOsGroupData) =>
                        !chatSearchText || (g.name || "").toLowerCase().includes(chatSearchText.toLowerCase()),
                    )
                    .map((group: MochiOsGroupData) => {
                      // Group bubbles live under `group_<id>`, the same key used when
                      // the thread is opened, so the row previews the real transcript.
                      const groupKey = `group_${group.id || ""}`;
                      const groupContact = currentContactsMap[groupKey];
                      const lastMsg = groupContact?.msgs?.length
                        ? groupContact.msgs[groupContact.msgs.length - 1]
                        : null;
                      const displayTime = lastMsg ? formatRelativeTime(lastMsg.d, lastMsg.t, isHour12) : "";

                      return (
                        <button
                          key={groupKey}
                          type="button"
                          className="crow"
                          onClick={() => {
                            setActiveGroupId(group.id ?? null);
                            setActiveContactId(groupKey);
                            setInChatView(true);
                          }}
                        >
                          <span
                            className="ava on"
                            style={{
                              background: "linear-gradient(135deg, var(--tile-a), var(--tile-b))",
                              color: "var(--ink)",
                            }}
                          >
                            {(group.name && group.name[0]?.toUpperCase()) || "G"}
                          </span>
                          <span className="info">
                            <b>{group.name || localizeUi("ui.chat.mochiosview.groupChat")}</b>
                            <span>
                              {groupContact?.preview ||
                                (lastMsg ? "" : localizeUi("ui.chat.mochiosview.noMessagesYet"))}
                            </span>
                          </span>
                          <span className="meta">
                            <time>{displayTime}</time>
                            {groupContact?.unread ? <span className="udot" /> : null}
                          </span>
                        </button>
                      );
                    })}

                {/* 2) Normal Direct Mochi OS Contacts */}
                {Object.entries(currentContactsMap)
                  .filter(
                    ([id, c]) =>
                      !id.startsWith("group_") &&
                      ((c.msgs && c.msgs.length > 0) || Boolean(c.preview)) &&
                      (!chatSearchText || c.name.toLowerCase().includes(chatSearchText.toLowerCase())),
                  )
                  .map(([id, c]) => {
                    const lastMsg = c.msgs.length > 0 ? c.msgs[c.msgs.length - 1] : null;
                    const displayTime = lastMsg ? formatRelativeTime(lastMsg.d, lastMsg.t, isHour12) : "";
                    return (
                      <button
                        key={id}
                        type="button"
                        className="crow"
                        onClick={() => {
                          setActiveGroupId(null);
                          setActiveContactId(id);
                          const setter = isPrivateMode ? setPrivateContacts : setContacts;
                          setter((prev) => ({
                            ...prev,
                            [id]: { ...prev[id], unread: 0 },
                          }));
                          setInChatView(true);
                        }}
                      >
                        <span
                          className={`ava ${c.online ? "on" : ""}`}
                          style={{ "--c": getMochiCharacterColor(c.name) } as React.CSSProperties}
                        >
                          {c.name[0]}
                        </span>
                        <span className="info">
                          <b>{c.name}</b>
                          <span>{c.preview}</span>
                        </span>
                        <span className="meta">
                          <time>{displayTime}</time>
                          {c.unread > 0 && <span className="udot" />}
                        </span>
                      </button>
                    );
                  })}

                {!savedPhoneDataResponse?.phoneData?.groups?.length && !Object.values(currentContactsMap).some((contact) => contact.msgs.length || contact.preview) && (
                  <div className="notice" style={{ marginTop: 40, textAlign: "center" }}>
                    {localizeUi("ui.chat.mochiosview.noMessagesYet")}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "calls" && (
            <div id="emptyMain">
              <div className="m-search">
                <svg viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder={localizeUi("ui.chat.mochiosview.searchCalls")}
                  value={callsSearchText}
                  onChange={(e) => setCallsSearchText(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="m-section-title">{localizeUi("ui.chat.mochiosview.recentCalls")}</div>
              <div className="notice" style={{ marginTop: 40, textAlign: "center" }}>
                {localizeUi("ui.chat.mochiosview.noMessagesYet")}
              </div>
            </div>
          )}

          {activeTab === "people" && (
            <div id="emptyMain">
              <div className="m-search">
                <svg viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder={localizeUi("ui.chat.mochiosview.searchPeople")}
                  value={peopleSearchText}
                  onChange={(e) => setPeopleSearchText(e.target.value)}
                  autoComplete="off"
                />
              </div>

              {/* Render generated characters from phone_data grouped by alphabet */}
              {savedPhoneDataResponse?.phoneData?.characters &&
              savedPhoneDataResponse.phoneData.characters.length > 0 ? (
                (() => {
                  const filteredChars = (savedPhoneDataResponse.phoneData.characters as MochiOsCharacterData[])
                    .filter(
                      (p: MochiOsCharacterData) =>
                        !peopleSearchText ||
                        (p.contactname || p.name || "").toLowerCase().includes(peopleSearchText.toLowerCase()) ||
                        (p.name || "").toLowerCase().includes(peopleSearchText.toLowerCase()) ||
                        mochiSocialHandle(p).toLowerCase().includes(peopleSearchText.toLowerCase()),
                    )
                    .sort((a, b) => (a.contactname || a.name || "").localeCompare(b.contactname || b.name || ""));

                  const groupedByLetter = filteredChars.reduce(
                    (acc: Record<string, MochiOsCharacterData[]>, person: MochiOsCharacterData) => {
                      const displayName = (person.contactname || person.name || "").trim();
                      const letter = displayName ? displayName[0].toUpperCase() : "#";
                      const key = /^[A-Z]$/.test(letter) ? letter : "#";
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(person);
                      return acc;
                    },
                    {},
                  );

                  const sortedLetters = Object.keys(groupedByLetter).sort((a, b) => {
                    if (a === "#") return 1;
                    if (b === "#") return -1;
                    return a.localeCompare(b);
                  });

                  if (filteredChars.length === 0) {
                    return (
                      <div className="notice" style={{ marginTop: 40, textAlign: "center" }}>
                        {localizeUi("ui.chat.mochiosview.noMessagesYet")}
                      </div>
                    );
                  }

                  return (
                    <div
                      ref={peopleListContainerRef}
                      style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 0 24px" }}
                    >
                      {sortedLetters.map((letter) => (
                        <div key={letter} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div className="mochi-person-alpha-header">{letter}</div>
                          {groupedByLetter[letter].map((person: MochiOsCharacterData) => {
                            const personId = person.id || person.name || "character";
                            const isExpanded = expandedPersonId === personId;
                            const effectiveDisplayName = person.contactname?.trim() || person.name || personId;
                            const initial = effectiveDisplayName ? effectiveDisplayName[0]?.toUpperCase() : "C";
                            const avatarBg = getMochiCharacterColor(person.name || personId);

                            return (
                              <div key={personId} className="mochi-person-item-wrap">
                                <div
                                  className={`mochi-person-card ${isExpanded ? "expanded" : ""}`}
                                  onClick={() => setExpandedPersonId((prev) => (prev === personId ? null : personId))}
                                >
                                  <div
                                    className="ava"
                                    style={{
                                      background: avatarBg,
                                      color: "#fff",
                                      width: 42,
                                      height: 42,
                                      borderRadius: "50%",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontWeight: 900,
                                      fontSize: 16,
                                      lineHeight: 1,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {initial}
                                  </div>
                                  <div className="info" style={{ flex: 1, minWidth: 0 }}>
                                    <b
                                      style={{
                                        display: "block",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {effectiveDisplayName}
                                    </b>
                                    {person.contactname && person.name && person.contactname !== person.name ? (
                                      <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 6 }}>
                                        ({person.name})
                                      </span>
                                    ) : null}
                                    {mochiSocialHandle(person) && (
                                      <span style={{ fontSize: 12, color: "var(--muted)" }}>@{mochiSocialHandle(person).replace(/^@/, "")}</span>
                                    )}
                                  </div>
                                  <div className="mochi-person-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      title={localizeUi("ui.chat.mochiosview.message")}
                                      onClick={() => {
                                        // Locate or create contact for person
                                        const contactId =
                                          Object.keys(currentContactsMap).find(
                                            (k) =>
                                              k.toLowerCase() === personId.toLowerCase() ||
                                              currentContactsMap[k]?.name?.toLowerCase() ===
                                                effectiveDisplayName.toLowerCase() ||
                                              currentContactsMap[k]?.name?.toLowerCase() ===
                                                (person.name || "").toLowerCase(),
                                          ) || personId;

                                        setActiveGroupId(null);
                                        setActiveContactId(contactId);

                                        const setter = isPrivateMode ? setPrivateContacts : setContacts;
                                        setter((prev) => {
                                          if (!prev[contactId]) {
                                            return {
                                              ...prev,
                                              [contactId]: {
                                                name: effectiveDisplayName,
                                                unread: 0,
                                                online: true,
                                                story: false,
                                                started: "Just now",
                                                color: avatarBg,
                                                preview: "",
                                                msgs: [],
                                              },
                                            };
                                          }
                                          return {
                                            ...prev,
                                            [contactId]: {
                                              ...prev[contactId],
                                              name: effectiveDisplayName,
                                              unread: 0,
                                            },
                                          };
                                        });

                                        setActiveTab("chats");
                                        setInChatView(true);
                                      }}
                                    >
                                      <svg viewBox="0 0 24 24">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      title={localizeUi("ui.chat.mochiosview.voiceCall")}
                                      onClick={() => {
                                        toast.info(localizeUi("ui.chat.mochiosview.comingSoon"));
                                      }}
                                    >
                                      <svg viewBox="0 0 24 24">
                                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      title={localizeUi("ui.chat.mochiosview.videoCall")}
                                      onClick={() => {
                                        toast.info(localizeUi("ui.chat.mochiosview.comingSoon"));
                                      }}
                                    >
                                      <svg viewBox="0 0 24 24">
                                        <path d="M23 7l-7 5 7 5V7z" />
                                        <rect x="1" y="5" width="15" height="14" rx="2" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>

                                {/* Info dropdown & editable fields */}
                                {isExpanded && (
                                  <div className="mochi-person-info-dropdown">
                                    {editingPersonId === personId ? (
                                      <div className="mochi-person-edit-form">
                                        <div className="profile-field-group">
                                          <label className="profile-field-label">
                                            {localizeUi("ui.chat.mochiosview.characterName")}
                                          </label>
                                          <div className="profile-field-input-wrap">
                                            <input
                                              type="text"
                                              className="profile-field-input"
                                              value={editingPersonFields.name}
                                              onChange={(e) =>
                                                setEditingPersonFields((prev) => ({ ...prev, name: e.target.value }))
                                              }
                                            />
                                          </div>
                                        </div>

                                        <div className="profile-field-group">
                                          <label className="profile-field-label">
                                            {localizeUi("ui.chat.mochiosview.contactName")}
                                          </label>
                                          <div className="profile-field-input-wrap">
                                            <input
                                              type="text"
                                              className="profile-field-input"
                                              placeholder={localizeUi("ui.chat.mochiosview.contactNamePlaceholder")}
                                              value={editingPersonFields.contactname}
                                              onChange={(e) =>
                                                setEditingPersonFields((prev) => ({
                                                  ...prev,
                                                  contactname: e.target.value,
                                                }))
                                              }
                                            />
                                          </div>
                                        </div>

                                        <div className="profile-field-group">
                                          <label className="profile-field-label">
                                            {localizeUi("ui.chat.mochiosview.socialHandle")}
                                          </label>
                                          <div className="profile-field-input-wrap">
                                            <input
                                              type="text"
                                              className="profile-field-input"
                                              placeholder="@socialhandle"
                                              value={editingPersonFields.socialhandle}
                                              onChange={(e) =>
                                                setEditingPersonFields((prev) => ({
                                                  ...prev,
                                                  socialhandle: e.target.value,
                                                }))
                                              }
                                            />
                                          </div>
                                        </div>

                                        <div className="profile-field-group">
                                          <label className="profile-field-label">
                                            {localizeUi("ui.chat.mochiosview.email")}
                                          </label>
                                          <div className="profile-field-input-wrap">
                                            <input
                                              type="email"
                                              className="profile-field-input"
                                              placeholder={localizeUi("ui.chat.mochiosview.emailPlaceholder")}
                                              value={editingPersonFields.email}
                                              onChange={(e) =>
                                                setEditingPersonFields((prev) => ({
                                                  ...prev,
                                                  email: e.target.value,
                                                }))
                                              }
                                            />
                                          </div>
                                        </div>

                                        <div className="profile-field-group">
                                          <label className="profile-field-label">
                                            {localizeUi("ui.chat.mochiosview.onlineStyle")}
                                          </label>
                                          <div className="profile-field-input-wrap">
                                            <input
                                              type="text"
                                              className="profile-field-input"
                                              value={editingPersonFields.onlineStyle}
                                              onChange={(e) =>
                                                setEditingPersonFields((prev) => ({
                                                  ...prev,
                                                  onlineStyle: e.target.value,
                                                }))
                                              }
                                            />
                                          </div>
                                        </div>

                                        <div className="mochi-person-edit-actions">
                                          <button
                                            type="button"
                                            className="mochi-person-save-btn"
                                            onClick={() => handleSavePersonToPhoneData(personId, editingPersonFields)}
                                          >
                                            {localizeUi("ui.chat.mochiosview.save")}
                                          </button>
                                          <button
                                            type="button"
                                            className="mochi-person-cancel-btn"
                                            onClick={() => setEditingPersonId(null)}
                                          >
                                            {localizeUi("ui.chat.mochiosview.cancel")}
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <div className="mochi-person-info-field">
                                          <span className="mochi-person-info-label">
                                            {localizeUi("ui.chat.mochiosview.characterId")}
                                          </span>
                                          <span className="mochi-person-info-value" style={{ fontFamily: "monospace" }}>
                                            {person.id || personId}
                                          </span>
                                        </div>
                                        <div className="mochi-person-info-field">
                                          <span className="mochi-person-info-label">{localizeUi("ui.chat.mochiosview.socialHandle")}</span>
                                          <span className="mochi-person-info-value">{mochiSocialHandle(person) || "—"}</span>
                                        </div>
                                        <div className="mochi-person-info-field">
                                          <span className="mochi-person-info-label">
                                            {localizeUi("ui.chat.mochiosview.email")}
                                          </span>
                                          <span className="mochi-person-info-value">{person.email || "—"}</span>
                                        </div>
                                        {(person.onlinestyle || person.online_style || person.onlineStyle) && (
                                          <div className="mochi-person-info-field">
                                            <span className="mochi-person-info-label">
                                              {localizeUi("ui.chat.mochiosview.onlineStyle")}
                                            </span>
                                            <span className="mochi-person-info-value">
                                              {person.onlinestyle || person.online_style || person.onlineStyle}
                                            </span>
                                          </div>
                                        )}
                                        <button
                                          type="button"
                                          className="mochi-person-edit-trigger-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingPersonId(personId);
                                            setEditingPersonFields({
                                              name: person.name || "",
                                              contactname: person.contactname || "",
                                              socialhandle: mochiSocialHandle(person),
                                              email: person.email || "",
                                              onlineStyle:
                                                person.onlineStyle || person.online_style || person.onlinestyle || "",
                                            });
                                          }}
                                        >
                                          {localizeUi("ui.chat.mochiosview.editPerson")}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <div className="notice" style={{ marginTop: 40, textAlign: "center" }}>
                  {localizeUi("ui.chat.mochiosview.noMessagesYet")}
                </div>
              )}
            </div>
          )}

          {activeTab === "profile" && (
            <div id="emptyMain" className="mochi-profile-view">
              <div className="profile-card">
                <div className="p-ava">
                  {activeLinkedPersona?.avatarPath ? (
                    <img
                      src={activeLinkedPersona.avatarPath}
                      alt=""
                      style={getAvatarCropStyle(activeLinkedPersona.avatarCrop)}
                    />
                  ) : (
                    <span>
                      {activeLinkedPersona
                        ? activeLinkedPersona.name[0]?.toUpperCase()
                        : localizeUi("ui.chat.mochiosview.y")}
                    </span>
                  )}
                </div>
                <h3>{activeLinkedPersona?.name || localizeUi("ui.noodle.stageprofileview.yourProfile")}</h3>

                {/* Nickname, User ID, and Email Input Fields */}
                <div className="profile-fields-list">
                  <div className="profile-field-group">
                    <label className="profile-field-label">{localizeUi("ui.chat.mochiosview.nickname")}</label>
                    <div className="profile-field-input-wrap">
                      <input
                        type="text"
                        className="profile-field-input"
                        placeholder={localizeUi("ui.chat.mochiosview.nicknamePlaceholder")}
                        value={profileNicknameDraft}
                        onChange={(e) => setProfileNicknameDraft(e.target.value)}
                        onBlur={() => {
                          const trimmed = profileNicknameDraft.trim();
                          handleSaveUserProfileToPhoneData({ nickname: trimmed });
                        }}
                      />
                    </div>
                  </div>

                  <div className="profile-field-group">
                    <label className="profile-field-label">{localizeUi("ui.chat.mochiosview.userId")}</label>
                    <div className="profile-field-input-wrap">
                      <input
                        type="text"
                        className="profile-field-input"
                        placeholder={localizeUi("ui.chat.mochiosview.userIdPlaceholder")}
                        value={profileUserIdDraft}
                        onChange={(e) => setProfileUserIdDraft(e.target.value)}
                        onBlur={() => {
                          handleSaveUserProfileToPhoneData({ userId: profileUserIdDraft.trim() });
                        }}
                      />
                    </div>
                  </div>

                  <div className="profile-field-group">
                    <label className="profile-field-label">{localizeUi("ui.chat.mochiosview.email")}</label>
                    <div className="profile-field-input-wrap">
                      <input
                        type="email"
                        className="profile-field-input"
                        placeholder={localizeUi("ui.chat.mochiosview.emailPlaceholder")}
                        value={profileEmailDraft}
                        onChange={(e) => setProfileEmailDraft(e.target.value)}
                        onBlur={() => {
                          handleSaveUserProfileToPhoneData({ email: profileEmailDraft.trim() });
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="p-actions">
                  <button
                    type="button"
                    className="edit-profile-btn"
                    onClick={() => {
                      setPersonaSearchText("");
                      setPersonaPickerOpen(true);
                    }}
                  >
                    {localizeUi("ui.noodle.stageprofileview.editProfile")}
                  </button>
                </div>
              </div>

              {/* Bio Container */}
              <div className="profile-bio-card">
                <label className="profile-field-label">{localizeUi("ui.chat.mochiosview.bio")}</label>
                <div className="profile-bio-textarea-wrap">
                  <textarea
                    className="profile-bio-textarea"
                    placeholder={localizeUi("ui.chat.mochiosview.bioPlaceholder")}
                    value={profileBioDraft}
                    onChange={(e) => setProfileBioDraft(e.target.value)}
                    onBlur={() => {
                      handleSaveUserProfileToPhoneData({ bio: profileBioDraft.trim() });
                    }}
                    rows={4}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Bottom Tabs */}
          <nav className="mtabs">
            <button
              type="button"
              className={`mtab ${activeTab === "chats" ? "active" : ""}`}
              onClick={() => setActiveTab("chats")}
            >
              <svg viewBox="0 0 24 24">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              <span>{localizeUi("navigation.common.chats")}</span>
            </button>
            <button
              type="button"
              className={`mtab ${activeTab === "calls" ? "active" : ""}`}
              onClick={() => setActiveTab("calls")}
            >
              <svg viewBox="0 0 24 24">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>{localizeUi("ui.chat.mochiosview.calls")}</span>
            </button>
            <button
              type="button"
              className={`mtab ${activeTab === "people" ? "active" : ""}`}
              onClick={() => setActiveTab("people")}
            >
              <svg viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>{localizeUi("ui.chat.mochiosview.people")}</span>
            </button>
            <button
              type="button"
              className={`mtab ${activeTab === "profile" ? "active" : ""}`}
              onClick={() => setActiveTab("profile")}
            >
              <svg viewBox="0 0 24 24">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>{localizeUi("chat.settingsProfile.label")}</span>
            </button>
          </nav>
        </div>

        {/* CHAT VIEW */}
        <div className="mview" id="chatView">
          {(() => {
            const groupObj = activeGroupObj;
            const chatDisplayName = groupObj?.name || currentActiveContact?.name || "Chat";
            const chatNameColor = activeCharacterColor;

            return (
              <>
                <div className="c-head" style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="icon-btn"
                    title={localizeUi("navigation.common.back")}
                    onClick={handleExitChatView}
                  >
                    <svg viewBox="0 0 24 24">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>

                  {groupObj ? (
                    <div className="mochi-group-profile-header-wrap">
                      <button
                        type="button"
                        className="mochi-group-profile-header-btn"
                        onClick={() => setGroupInfoOpen((prev) => !prev)}
                        title={localizeUi("ui.chat.mochiosview.groupInfo")}
                      >
                        <span
                          className="ava"
                          style={{
                            background: "linear-gradient(135deg, var(--tile-a), var(--tile-b))",
                            color: "var(--ink)",
                          }}
                        >
                          {chatDisplayName[0]?.toUpperCase() || "G"}
                        </span>
                        <b style={{ color: "var(--text)", fontSize: 16 }}>{chatDisplayName}</b>
                      </button>
                    </div>
                  ) : (
                    <>
                      <span
                        className="ava"
                        style={{
                          background: chatNameColor,
                        }}
                      >
                        {chatDisplayName[0]?.toUpperCase() || "C"}
                      </span>
                      <b>{chatDisplayName}</b>
                    </>
                  )}

                  <button type="button" className="icon-btn" title={localizeUi("ui.chat.mochiosview.voiceCall")}>
                    <svg viewBox="0 0 24 24">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                  </button>
                  <button type="button" className="icon-btn" title={localizeUi("ui.chat.mochiosview.videoCall")}>
                    <svg viewBox="0 0 24 24">
                      <path d="M23 7l-7 5 7 5V7z" />
                      <rect x="1" y="5" width="15" height="14" rx="2" />
                    </svg>
                  </button>
                </div>

                {/* Chat Body */}
                <div className="c-body" ref={chatBodyRef}>
                  {effectiveChatId ? (
                    realChatMessages.length > 0 ? (
                      (() => {
                        let lastDate = "";
                        return (
                          <>
                            {realChatMessages.map((msg, idx) => {
                              const isUser = msg.role === "user";
                              const d = msg.createdAt
                                ? new Date(msg.createdAt).toLocaleDateString("en-US", {
                                    month: "long",
                                    day: "numeric",
                                    year: "numeric",
                                  })
                                : "";
                              const showDateNotice = d && d !== lastDate;
                              if (showDateNotice) lastDate = d;
                              const ts = msg.createdAt ? fmtTime(new Date(msg.createdAt), isHour12) : "";
                              const isVoice = msg.content.includes("🎤 Voice note");
                              const extra = typeof msg.extra === "string" ? JSON.parse(msg.extra) : (msg.extra ?? {});
                              const reactions: MessageReaction[] = Array.isArray(extra.reactions)
                                ? extra.reactions
                                : [];

                              return (
                                <React.Fragment key={msg.id || idx}>
                                  {showDateNotice && <div className="notice">{d}</div>}
                                  {isUser ? (
                                    <div
                                      className={`mrow out${activeMochiMsgActionId === (msg.id || idx) ? " actions-visible" : ""}`}
                                      {...mochiMessageInteraction({ id: msg.id || idx, author: userScreenName, text: msg.content, isOutgoing: true })}
                                    >
                                      <span className="wmsg">
                                        {isVoice ? (
                                          <div className="b out voice">
                                            <span className="play">
                                              <svg viewBox="0 0 12 14">
                                                <path d="M0 0l12 7-12 7z" />
                                              </svg>
                                            </span>
                                            <span className="wave">
                                              {VOICE_WAVE_HEIGHTS.map((h, i) => (
                                                <i key={i} style={{ height: `${h}px` }} />
                                              ))}
                                            </span>
                                            <time>0:07</time>
                                          </div>
                                        ) : (
                                          <div className="b out">{msg.content}</div>
                                        )}
                                        {reactions.length > 0 && (
                                          <div className="mochi-reaction-row">
                                            <MessageReactions
                                              reactions={reactions}
                                              resolveReactorName={resolveReactorName}
                                              onToggle={(reaction) => {
                                                const next = toggleReaction(
                                                  reactions,
                                                  reaction.emoji,
                                                  USER_REACTOR,
                                                  reaction.imageUrl ?? null,
                                                  reactionTargetOf(reaction),
                                                );
                                                void applyReactionsToMessage(msg.id, next);
                                              }}
                                              onRemoveCharacter={(reaction) => {
                                                const next = removeCharacterReaction(reactions, reaction);
                                                void applyReactionsToMessage(msg.id, next);
                                              }}
                                            />
                                          </div>
                                        )}
                                        <span className="mt">{ts}</span>
                                        <MochiMessageActions inert={activeMochiMsgActionId !== (msg.id || idx)}>
                                          <ReactionAddButton
                                            className="mochi-reaction-btn"
                                            onPick={(emoji, imageUrl) => {
                                              const next = toggleReaction(reactions, emoji, USER_REACTOR, imageUrl);
                                              void applyReactionsToMessage(msg.id, next);
                                            }}
                                          />
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setReplyingToMochiMessage({
                                                author: "You",
                                                text: msg.content,
                                                isOutgoing: true,
                                              })
                                            }
                                            title={localizeUi("ui.chat.mochiosview.reply")}
                                            className="mochi-reaction-btn"
                                          >
                                            <CornerUpLeft size={13} />
                                          </button>
                                        </MochiMessageActions>
                                      </span>
                                    </div>
                                  ) : (
                                    <div
                                      className={`mrow${activeMochiMsgActionId === (msg.id || idx) ? " actions-visible" : ""}`}
                                      {...mochiMessageInteraction({ id: msg.id || idx, author: chatDisplayName, text: msg.content, isOutgoing: false })}
                                    >
                                      <MochiMessageIdentity name={chatDisplayName} color={chatNameColor} />
                                      <span className="wmsg">
                                        {isVoice ? (
                                          <div className="b in voice">
                                            <span className="play">
                                              <svg viewBox="0 0 12 14">
                                                <path d="M0 0l12 7-12 7z" />
                                              </svg>
                                            </span>
                                            <span className="wave">
                                              {VOICE_WAVE_HEIGHTS.map((h, i) => (
                                                <i key={i} style={{ height: `${h}px` }} />
                                              ))}
                                            </span>
                                            <time>0:07</time>
                                          </div>
                                        ) : (
                                          <div className="b in">{msg.content}</div>
                                        )}
                                        {reactions.length > 0 && (
                                          <div className="mochi-reaction-row">
                                            <MessageReactions
                                              reactions={reactions}
                                              resolveReactorName={resolveReactorName}
                                              onToggle={(reaction) => {
                                                const next = toggleReaction(
                                                  reactions,
                                                  reaction.emoji,
                                                  USER_REACTOR,
                                                  reaction.imageUrl ?? null,
                                                  reactionTargetOf(reaction),
                                                );
                                                void applyReactionsToMessage(msg.id, next);
                                              }}
                                              onRemoveCharacter={(reaction) => {
                                                const next = removeCharacterReaction(reactions, reaction);
                                                void applyReactionsToMessage(msg.id, next);
                                              }}
                                            />
                                          </div>
                                        )}
                                        <span className="mt">{ts}</span>
                                        <MochiMessageActions inert={activeMochiMsgActionId !== (msg.id || idx)}>
                                          <ReactionAddButton
                                            className="mochi-reaction-btn"
                                            onPick={(emoji, imageUrl) => {
                                              const next = toggleReaction(reactions, emoji, USER_REACTOR, imageUrl);
                                              void applyReactionsToMessage(msg.id, next);
                                            }}
                                          />
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setReplyingToMochiMessage({
                                                author: chatDisplayName,
                                                text: msg.content,
                                                isOutgoing: false,
                                              })
                                            }
                                            title={localizeUi("ui.chat.mochiosview.reply")}
                                            className="mochi-reaction-btn"
                                          >
                                            <CornerUpLeft size={13} />
                                          </button>
                                        </MochiMessageActions>
                                          {((msg.swipeCount ?? 0) > 1 || idx === realChatMessages.length - 1) && (
                                            <div className="mochi-swipe-trigger" inert={activeMochiMsgActionId !== (msg.id || idx)}>
                                              <button
                                                type="button"
                                                disabled={(msg.activeSwipeIndex ?? 0) <= 0}
                                                onClick={() =>
                                                  void setActiveSwipe.mutateAsync({
                                                    messageId: msg.id,
                                                    index: (msg.activeSwipeIndex ?? 0) - 1,
                                                  })
                                                }
                                                title={localizeUi(
                                                  "ui.chat.swipejumpcontrol.previousSwipe",
                                                  "Previous swipe",
                                                )}
                                              >
                                                <ChevronLeft size={13} />
                                              </button>
                                              <span className="mochi-swipe-indicator">
                                                {(msg.activeSwipeIndex ?? 0) + 1}/{Math.max(1, msg.swipeCount ?? 1)}
                                              </span>
                                              <button
                                                type="button"
                                                disabled={
                                                  idx < realChatMessages.length - 1 &&
                                                  (msg.activeSwipeIndex ?? 0) >= (msg.swipeCount ?? 1) - 1
                                                }
                                                onClick={() => {
                                                  const currentIdx = msg.activeSwipeIndex ?? 0;
                                                  const totalSwipes = Math.max(1, msg.swipeCount ?? 1);
                                                  if (currentIdx < totalSwipes - 1) {
                                                    void setActiveSwipe.mutateAsync({
                                                      messageId: msg.id,
                                                      index: currentIdx + 1,
                                                    });
                                                  } else if (effectiveChatId) {
                                                    void generate({
                                                      chatId: effectiveChatId,
                                                      connectionId: null,
                                                      regenerateMessageId: msg.id,
                                                      ...(promptPresetMode === "engine" && selectedEnginePresetId
                                                        ? { presetId: selectedEnginePresetId }
                                                        : {}),
                                                    });
                                                  }
                                                }}
                                                title={
                                                  (msg.activeSwipeIndex ?? 0) < Math.max(1, msg.swipeCount ?? 1) - 1
                                                    ? localizeUi("ui.chat.swipejumpcontrol.nextSwipe", "Next swipe")
                                                    : localizeUi(
                                                        "ui.chat.swipejumpcontrol.generateNextSwipe",
                                                        "Generate next swipe",
                                                      )
                                                }
                                              >
                                                <ChevronRight size={13} />
                                              </button>
                                            </div>
                                          )}
                                      </span>
                                    </div>
                                  )}
                                </React.Fragment>
                              );
                            })}

                            {/* Streaming response bubble */}
                            {isChatGenerating && streamBuffer && (
                              <div className="mrow">
                                <span
                                  className="mini"
                                  style={{
                                    overflow: "hidden",
                                    background: chatNameColor,
                                  }}
                                >
                                  {chatDisplayName[0]?.toUpperCase()}
                                </span>
                                <span className="wmsg">
                                  <div className="b in">{streamBuffer}</div>
                                  <span className="mt">{localizeUi("ui.chat.mochiosview.typing")}</span>
                                </span>
                              </div>
                            )}

                            {/* Typing indicator dots */}
                            {isChatGenerating && !streamBuffer && (
                              <div className="mrow">
                                <span
                                  className="mini"
                                  style={{
                                    overflow: "hidden",
                                    background: chatNameColor,
                                  }}
                                >
                                  {chatDisplayName[0]?.toUpperCase()}
                                </span>
                                <span className="wmsg">
                                  <div className="b in">
                                    <div className="typing-dots">
                                      <span />
                                      <span />
                                      <span />
                                    </div>
                                  </div>
                                </span>
                              </div>
                            )}
                          </>
                        );
                      })()
                    ) : (
                      <div className="notice" style={{ marginTop: 20 }}>
                        {localizeUi("ui.chat.mochiosview.noMessagesYet")}
                      </div>
                    )
                  ) : currentActiveContact?.msgs.length ? (
                    // Demo contact message list fallback
                    (() => {
                      let lastDate = "";
                      return currentActiveContact.msgs.map((m, idx) => {
                        const rawD = (m.d || currentActiveContact.started || "").trim();
                        // Normalize date string (strip extra whitespace / lowercase check) to prevent duplicate notices
                        const normalizedD = rawD.toLowerCase();
                        const showDateNotice = rawD && normalizedD !== lastDate.toLowerCase();
                        if (showDateNotice) lastDate = rawD;
                        const ts = fmtMsgTime(m.t, isHour12);
                        const demoReactions = m.reactions ?? [];

                        const msgBubbleId = m.id || `msg_${String(idx + 1).padStart(3, "0")}`;

                        // Who this bubble reads as coming from. A group thread
                        // carries the author on every message; a private chat's
                        // reader is the single contact, so the contact stands in.
                        const bubbleSender = isGroupThread ? m.sender?.trim() || "" : "";
                        const bubbleAuthor = bubbleSender || currentActiveContact.name;
                        const identityName = m.me === 1 ? userScreenName : bubbleAuthor;
                        const identityCharacter = m.me === 1 ? undefined : realCharacters.find((character) => {
                          const names = [character.data?.name, character.name, character.comment];
                          if (names.some((name) => typeof name === "string" && name.toLowerCase() === bubbleAuthor.toLowerCase())) return true;
                          const contact = savedPhoneDataResponse?.phoneData?.characters?.find((entry) =>
                            [entry.name, entry.contactname, mochiSocialHandle(entry), entry.nickname, entry.id].some((name) => name?.toLowerCase() === bubbleAuthor.toLowerCase()),
                          );
                          return Boolean(contact && (character.id === contact.id || character.data?.name === contact.name));
                        });

                        const rpLocation =
                          m.me !== 1 && activeChatId
                            ? locateMochiMessageInRoleplay({
                                roleplayMessages: activeChatRoleplayMessages,
                                userName: activeLinkedPersona?.name || "User",
                                targetName: currentActiveContact.name || "",
                                recordType: activeRecordType,
                                threadIndex: idx,
                                threadMessageId: m.id,
                              })
                            : null;
                        const rpSwipeMsg = rpLocation
                          ? activeChatRoleplayMessages.find((msg) => msg.id === rpLocation.roleplayMessageId)
                          : undefined;
                        const bubbleSwipeCount = rpSwipeMsg ? (rpSwipeMsg.swipeCount ?? 1) : (m.swipes?.length ?? 1);
                        const bubbleActiveSwipeIdx = rpSwipeMsg
                          ? (rpSwipeMsg.activeSwipeIndex ?? 0)
                          : (m.activeSwipeIndex ?? Math.max(0, bubbleSwipeCount - 1));
                        const isLastBubbleInThread = idx === (currentActiveContact?.msgs.length ?? 0) - 1;
                        const isRecordEndBubble =
                          !rpLocation ||
                          idx + 1 >= currentActiveContact.msgs.length ||
                          currentActiveContact.msgs[idx + 1]?.me === 1 ||
                          locateMochiMessageInRoleplay({
                            roleplayMessages: activeChatRoleplayMessages,
                            userName: activeLinkedPersona?.name || "User",
                            targetName: currentActiveContact.name || "",
                            recordType: activeRecordType,
                            threadIndex: idx + 1,
                            threadMessageId: currentActiveContact.msgs[idx + 1]?.id,
                          })?.roleplayMessageId !== rpLocation.roleplayMessageId;

                        return (
                          <React.Fragment key={m.id || idx}>
                            {showDateNotice && <div className="notice">{rawD}</div>}
                            {m.me === 1 ? (
                              <div
                                className={`mrow out${activeMochiMsgActionId === msgBubbleId ? " actions-visible" : ""}`}
                                data-msg-id={msgBubbleId}
                                {...mochiMessageInteraction({ id: msgBubbleId, author: identityName, text: m.text || mochiMessagePreview(m), isOutgoing: true })}
                              >
                                <span className="wmsg">
                                  {m.type === "sticker" ? (
                                    <span className="sticker">
                                      {conversationStickerMap.get(MochiStickerName(m.text || "")) ? (
                                        <img
                                          className="mochi-chat-sticker-image"
                                          src={conversationStickerMap.get(MochiStickerName(m.text || ""))}
                                          alt={m.text || "Sticker"}
                                        />
                                      ) : (
                                        m.text
                                      )}
                                    </span>
                                  ) : m.type === "voice" ? (
                                    <div className="b out voice">
                                      <span className="play">
                                        <svg viewBox="0 0 12 14">
                                          <path d="M0 0l12 7-12 7z" />
                                        </svg>
                                      </span>
                                      <span className="wave">
                                        {VOICE_WAVE_HEIGHTS.map((h, i) => (
                                          <i key={i} style={{ height: `${h}px` }} />
                                        ))}
                                      </span>
                                      <time>{m.dur || "0:07"}</time>
                                    </div>
                                  ) : isMochiTransferType(m.type) ? (
                                    <MochiTransferBubble
                                      message={m}
                                      direction="out"
                                      currency={currency}
                                      pending={false}
                                    />
                                  ) : editingMsgIdx === idx ? (
                                    <div className="b out mochi-message-edit">
                                      <textarea
                                        value={editingMsgText}
                                        onChange={(e) => setEditingMsgText(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSaveEditMochiMessage(idx, m.id);
                                          } else if (e.key === "Escape") {
                                            handleCancelEditMochiMessage();
                                          }
                                        }}
                                        className="mochi-message-edit-input"
                                        autoFocus
                                      />
                                      <div className="mochi-message-edit-actions">
                                        <button
                                          type="button"
                                          onClick={handleCancelEditMochiMessage}
                                          className="mochi-message-edit-cancel"
                                        >
                                          {localizeUi("ui.chat.mochiosview.cancel")}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleSaveEditMochiMessage(idx, m.id)}
                                          className="mochi-message-edit-save"
                                        >
                                          {localizeUi("ui.chat.mochiosview.save")}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <MochiTextBubble
                                        message={m}
                                        direction="out"
                                        stickerMap={conversationStickerMap}
                                      />
                                    </>
                                  )}
                                  {demoReactions.length > 0 && (
                                    <div className="mochi-reaction-row">
                                      <MessageReactions
                                        reactions={demoReactions}
                                        resolveReactorName={resolveReactorName}
                                        onToggle={(reaction) => handleToggleDemoReactionEntry(idx, reaction)}
                                        onRemoveCharacter={(reaction) =>
                                          handleRemoveDemoCharacterReaction(idx, reaction)
                                        }
                                      />
                                    </div>
                                  )}
                                  <span className="mt">{ts}</span>
                                  <MochiMessageActions inert={activeMochiMsgActionId !== msgBubbleId}>
                                    <ReactionAddButton
                                      className="mochi-reaction-btn"
                                      onPick={(emoji, imageUrl) => handleDemoReaction(idx, emoji, imageUrl)}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleCopyMochiMessage(idx, m.text || "")}
                                      title={localizeUi("lorebook.editor.batch.copy")}
                                      className="mochi-reaction-btn"
                                    >
                                      {copiedMsgIdx === idx ? (
                                        <Check size={14} className="text-emerald-400" />
                                      ) : (
                                        <Copy size={13} />
                                      )}
                                    </button>
                                    {m.type !== "sticker" && m.type !== "voice" && !isMochiTransferType(m.type) && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => handleStartEditMochiMessage(idx, m.text || "")}
                                          title={localizeUi("ui.noodle.noodlepostcard.edit")}
                                          className="mochi-reaction-btn"
                                        >
                                          <Pencil size={13} />
                                        </button>
                                      </>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setReplyingToMochiMessage({
                                          author: "You",
                                          text: m.text || "",
                                          isOutgoing: true,
                                        })
                                      }
                                      title={localizeUi("ui.chat.mochiosview.reply")}
                                      className="mochi-reaction-btn"
                                    >
                                      <CornerUpLeft size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleBranchMochiMessage(idx)}
                                      title={localizeUi("ui.chat.chatmessage.branchFromHere")}
                                      className="mochi-reaction-btn"
                                    >
                                      <GitBranch size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteMochiMessage(idx, m.id)}
                                      title={localizeUi("lorebook.editor.batch.delete")}
                                      className="mochi-reaction-btn hover:text-red-400 hover:border-red-400/40"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </MochiMessageActions>
                                </span>
                              </div>
                            ) : (
                              <div
                                className={`mrow${activeMochiMsgActionId === msgBubbleId ? " actions-visible" : ""}`}
                                data-msg-id={msgBubbleId}
                                {...mochiMessageInteraction({ id: msgBubbleId, author: identityName, text: m.text || mochiMessagePreview(m), isOutgoing: false })}
                              >
                                <MochiMessageIdentity name={identityName} color={isGroupThread && bubbleSender ? getMochiCharacterColor(bubbleSender) : activeCharacterColor} avatar={identityCharacter?.avatarPath} crop={identityCharacter?.avatarCrop} />
                                <span className="wmsg">
                                  {m.type === "sticker" ? (
                                    <span className="sticker">
                                      {conversationStickerMap.get(MochiStickerName(m.text || "")) ? (
                                        <img
                                          className="mochi-chat-sticker-image"
                                          src={conversationStickerMap.get(MochiStickerName(m.text || ""))}
                                          alt={m.text || "Sticker"}
                                        />
                                      ) : (
                                        m.text
                                      )}
                                    </span>
                                  ) : m.type === "voice" ? (
                                    <div className="b in voice">
                                      <span className="play">
                                        <svg viewBox="0 0 12 14">
                                          <path d="M0 0l12 7-12 7z" />
                                        </svg>
                                      </span>
                                      <span className="wave">
                                        {VOICE_WAVE_HEIGHTS.map((h, i) => (
                                          <i key={i} style={{ height: `${h}px` }} />
                                        ))}
                                      </span>
                                      <time>{m.dur || "0:07"}</time>
                                    </div>
                                  ) : isMochiTransferType(m.type) ? (
                                    <MochiTransferBubble
                                      message={m}
                                      direction="in"
                                      currency={currency}
                                      pending={pendingTransferIdx === idx}
                                      onAccept={() => void handleAnswerTransfer("accepted")}
                                      onReject={() => void handleAnswerTransfer("rejected")}
                                    />
                                  ) : editingMsgIdx === idx ? (
                                    <div className="b in mochi-message-edit">
                                      <textarea
                                        value={editingMsgText}
                                        onChange={(e) => setEditingMsgText(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSaveEditMochiMessage(idx, m.id);
                                          } else if (e.key === "Escape") {
                                            handleCancelEditMochiMessage();
                                          }
                                        }}
                                        className="mochi-message-edit-input"
                                        autoFocus
                                      />
                                      <div className="mochi-message-edit-actions">
                                        <button
                                          type="button"
                                          onClick={handleCancelEditMochiMessage}
                                          className="mochi-message-edit-cancel"
                                        >
                                          {localizeUi("ui.chat.mochiosview.cancel")}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleSaveEditMochiMessage(idx, m.id)}
                                          className="mochi-message-edit-save"
                                        >
                                          {localizeUi("ui.chat.mochiosview.save")}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <MochiTextBubble message={m} direction="in" stickerMap={conversationStickerMap} />
                                    </>
                                  )}
                                  {demoReactions.length > 0 && (
                                    <div className="mochi-reaction-row">
                                      <MessageReactions
                                        reactions={demoReactions}
                                        resolveReactorName={resolveReactorName}
                                        onToggle={(reaction) => handleToggleDemoReactionEntry(idx, reaction)}
                                        onRemoveCharacter={(reaction) =>
                                          handleRemoveDemoCharacterReaction(idx, reaction)
                                        }
                                      />
                                    </div>
                                  )}
                                  <span className="mochi-bubble-meta">
                                    {isGroupThread && <MochiGroupSenderLabel name={bubbleSender} />}
                                    <span className="mt">{ts}</span>
                                  </span>
                                  <MochiMessageActions inert={activeMochiMsgActionId !== msgBubbleId}>
                                    <ReactionAddButton
                                      className="mochi-reaction-btn"
                                      onPick={(emoji, imageUrl) => handleDemoReaction(idx, emoji, imageUrl)}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleCopyMochiMessage(idx, m.text || "")}
                                      title={localizeUi("lorebook.editor.batch.copy")}
                                      className="mochi-reaction-btn"
                                    >
                                      {copiedMsgIdx === idx ? (
                                        <Check size={14} className="text-emerald-400" />
                                      ) : (
                                        <Copy size={13} />
                                      )}
                                    </button>
                                    {m.type !== "sticker" && m.type !== "voice" && !isMochiTransferType(m.type) && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => handleStartEditMochiMessage(idx, m.text || "")}
                                          title={localizeUi("ui.noodle.noodlepostcard.edit")}
                                          className="mochi-reaction-btn"
                                        >
                                          <Pencil size={13} />
                                        </button>
                                      </>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setReplyingToMochiMessage({
                                          // Quote the person actually being replied to, which in a
                                          // group is the sender rather than the group.
                                          author: bubbleAuthor,
                                          text: m.text || "",
                                          isOutgoing: false,
                                        })
                                      }
                                      title={localizeUi("ui.chat.mochiosview.reply")}
                                      className="mochi-reaction-btn"
                                    >
                                      <CornerUpLeft size={13} />
                                    </button>
                                    {isRecordEndBubble && (
                                      <button
                                        type="button"
                                        onClick={() => handleRegenerateMochiMessage(idx)}
                                        title={localizeUi("ui.chat.chatmessage.regenerate", "Regenerate")}
                                        className="mochi-reaction-btn hover:text-[var(--acc)]"
                                      >
                                        <RefreshCw size={13} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleBranchMochiMessage(idx)}
                                      title={localizeUi("ui.chat.chatmessage.branchFromHere")}
                                      className="mochi-reaction-btn"
                                    >
                                      <GitBranch size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteMochiMessage(idx, m.id)}
                                      title={localizeUi("lorebook.editor.batch.delete")}
                                      className="mochi-reaction-btn hover:text-red-400 hover:border-red-400/40"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </MochiMessageActions>
                                    {isRecordEndBubble && (bubbleSwipeCount > 1 || isLastBubbleInThread) && (
                                      <div className="mochi-swipe-trigger" inert={activeMochiMsgActionId !== msgBubbleId}>
                                        <button
                                          type="button"
                                          disabled={bubbleActiveSwipeIdx <= 0}
                                          onClick={() => handleSwipeMochiMessage(idx, -1)}
                                          title={localizeUi("ui.chat.swipejumpcontrol.previousSwipe", "Previous swipe")}
                                        >
                                          <ChevronLeft size={13} />
                                        </button>
                                        <span className="mochi-swipe-indicator">
                                          {bubbleActiveSwipeIdx + 1}/{bubbleSwipeCount}
                                        </span>
                                        <button
                                          type="button"
                                          disabled={
                                            !isLastBubbleInThread && bubbleActiveSwipeIdx >= bubbleSwipeCount - 1
                                          }
                                          onClick={() => handleSwipeMochiMessage(idx, 1)}
                                          title={
                                            bubbleActiveSwipeIdx < bubbleSwipeCount - 1
                                              ? localizeUi("ui.chat.swipejumpcontrol.nextSwipe", "Next swipe")
                                              : localizeUi(
                                                  "ui.chat.swipejumpcontrol.generateNextSwipe",
                                                  "Generate next swipe",
                                                )
                                          }
                                        >
                                          <ChevronRight size={13} />
                                        </button>
                                      </div>
                                    )}
                                </span>
                              </div>
                            )}
                          </React.Fragment>
                        );
                      });
                    })()
                  ) : (
                    <div className="notice" style={{ marginTop: 20 }}>
                      {localizeUi("ui.chat.mochiosview.noMessagesYet")}
                    </div>
                  )}

                  {/* Typing indicator for Mochi OS AI direct chat */}
                  {!effectiveChatId && isMochiAiGenerating && (
                    <div className="mrow">
                      <span className="mini" style={{ "--c": activeCharacterColor } as React.CSSProperties}>
                        {(currentActiveContact?.name || chatDisplayName)[0]}
                      </span>
                      <span className="wmsg">
                        <div className="b in">
                          <div className="typing-dots">
                            <span />
                            <span />
                            <span />
                          </div>
                        </div>
                      </span>
                    </div>
                  )}
                </div>

                {/* Slash Command Feedback */}
                {slashFeedback && (
                  <div style={{ padding: "0 14px 8px 14px" }}>
                    <SlashCommandFeedback feedback={slashFeedback} onDismiss={() => setSlashFeedback(null)} />
                  </div>
                )}

                {/* Chat Composer */}
                <div className="mochi-composer">
                  {replyingToMochiMessage && (
                    <div
                      className={`mochi-reply-preview ${replyingToMochiMessage.isOutgoing ? "outgoing" : "incoming"}`}
                    >
                      <span className="mochi-reply-mark" />
                      <div className="mochi-reply-copy">
                        <strong>
                          {localizeUi("ui.chat.mochiosview.replyingTo", { author: replyingToMochiMessage.author })}
                        </strong>
                        <span>{replyingToMochiMessage.text}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyingToMochiMessage(null)}
                        aria-label={localizeUi("common.cancel")}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  )}

                  <div className={`c-bar ${composerPlusOpen ? "open" : ""}`} style={{ position: "relative" }}>
                    {/* Slash Autocomplete Popover */}
                    {slashCompletions.length > 0 && (
                      <div className="mochi-slash-autocomplete-menu">
                        {slashCompletions.map((comp, idx) => (
                          <button
                            key={comp.name || comp.key || idx}
                            type="button"
                            className={`mochi-slash-autocomplete-item ${selectedSlashIndex === idx ? "selected" : ""}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setMsgInputText(`/${comp.name} `);
                              setSlashCompletions([]);
                            }}
                          >
                            <span className="slash-label">/{comp.name}</span>
                            {comp.description && <span className="slash-desc">{comp.description}</span>}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Media Picker Popover */}
                    {mediaPickerOpen && (
                        <ConversationMediaPickerPanel
                          tabs={[
                            { id: "emoji", label: "Emoji" },
                            { id: "stickers", label: "Stickers" },
                          ]}
                          activeTab={mediaPickerTab}
                          onActiveTabChange={setMediaPickerTab}
                          onClose={() => setMediaPickerOpen(false)}
                          onEmojiSelect={(emoji) => {
                            setMsgInputText((prev) => prev + emoji);
                            setMediaPickerOpen(false);
                            composerInputRef.current?.focus();
                          }}
                          onStickerSelect={(name) => {
                            pushMessageToCurrentContact({ me: 1, type: "sticker", rawType: "sticker", text: name });
                            setMediaPickerOpen(false);
                          }}
                        />
                    )}

                    <div className="plus-wrap">
                      <div className="plus-menu" aria-label="More chat options" inert={!composerPlusOpen}>
                        <button
                          type="button"
                          className="rbtn"
                          id="emojiBtn"
                          title={localizeUi("chat.input.emoji")}
                          onClick={() => {
                            setMediaPickerTab("emoji");
                            setMediaPickerOpen((prev) => !prev);
                            setComposerPlusOpen(false);
                          }}
                        >
                          <svg viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                            <line x1="9" y1="9" x2="9.01" y2="9" />
                            <line x1="15" y1="9" x2="15.01" y2="9" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="rbtn"
                          id="micBtn"
                          title={localizeUi("ui.chat.mochiosview.voiceNote")}
                          onClick={() => {
                            setComposerPlusOpen(false);
                            resetVoice();
                            setVoiceModalOpen(true);
                          }}
                        >
                          <svg viewBox="0 0 24 24">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="23" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="rbtn"
                          id="stickerBtn"
                          title={localizeUi("ui.noodle.noodlerschedulemanagermodal.images")}
                          onClick={() => {
                            setComposerPlusOpen(false);
                            setAiSelectedNames([]);
                            setImagesModalOpen(true);
                          }}
                        >
                          <svg viewBox="0 0 24 24">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="rbtn"
                          id="transferBtn"
                          title={localizeUi("ui.chat.mochiosview.transfer")}
                          onClick={() => {
                            setComposerPlusOpen(false);
                            setTransferAmount("");
                            setTransferNote("");
                            setTransferModalOpen(true);
                          }}
                        >
                          {/* Banknote: a bill with a centered denomination mark. */}
                          <svg viewBox="0 0 24 24">
                            <rect x="2" y="6" width="20" height="12" rx="2" />
                            <circle cx="12" cy="12" r="2.6" />
                            <line x1="6" y1="10" x2="6" y2="10.01" />
                            <line x1="18" y1="10" x2="18" y2="10.01" />
                            <line x1="6" y1="14" x2="6" y2="14.01" />
                            <line x1="18" y1="14" x2="18" y2="14.01" />
                          </svg>
                        </button>
                      </div>
                      <button
                        type="button"
                        className="rbtn"
                        id="plusBtn"
                        title={localizeUi("ui.chat.mochiosview.more")}
                        aria-expanded={composerPlusOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          setComposerPlusOpen((p) => !p);
                        }}
                      >
                        <svg viewBox="0 0 24 24">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                    </div>

                    {/* Quick Connection Switcher on the right of the more button */}
                    {effectiveChatId && (
                      <div className="mochi-connection-switcher-wrap">
                        <QuickConnectionSwitcher chatId={effectiveChatId} className="rbtn" />
                      </div>
                    )}

                    <input
                      ref={composerInputRef}
                      type="text"
                      enterKeyHint="send"
                      placeholder={chatInputPlaceholder}
                      value={msgInputText}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMsgInputText(val);
                        if (val.startsWith("/")) {
                          const comps = getSlashCompletions(val, {
                            mode: "conversation",
                            availableCapabilityIds,
                          });
                          setSlashCompletions(comps);
                          setSelectedSlashIndex(0);
                        } else {
                          setSlashCompletions([]);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (slashCompletions.length > 0) {
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setSelectedSlashIndex((prev) => (prev + 1) % slashCompletions.length);
                            return;
                          }
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setSelectedSlashIndex(
                              (prev) => (prev - 1 + slashCompletions.length) % slashCompletions.length,
                            );
                            return;
                          }
                          if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                            e.preventDefault();
                            const comp = slashCompletions[selectedSlashIndex];
                            if (comp) {
                              setMsgInputText(`/${comp.name} `);
                              setSlashCompletions([]);
                            }
                            return;
                          }
                          if (e.key === "Escape") {
                            setSlashCompletions([]);
                            return;
                          }
                        }
                        if (e.key === "Enter" || e.key === "NumpadEnter" || e.keyCode === 13) {
                          e.preventDefault();
                          void handleSendText(e.currentTarget.value);
                        }
                      }}
                      onKeyUp={(e) => {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (
                          slashCompletions.length === 0 &&
                          (e.key === "Enter" || e.key === "NumpadEnter" || e.keyCode === 13) &&
                          e.currentTarget.value.trim()
                        ) {
                          e.preventDefault();
                          void handleSendText(e.currentTarget.value);
                        }
                      }}
                      autoComplete="off"
                    />

                    <button
                      type="button"
                      className={`rbtn ${isChatGenerating ? "generating" : ""}`}
                      title={isChatGenerating ? localizeUi("chat.input.stopGenerating") : localizeUi("chat.input.send")}
                      onClick={() => handleSendText(msgInputText)}
                    >
                      <svg viewBox="0 0 24 24" style={{ marginLeft: -2, marginTop: 1 }}>
                        <path d="M22 2L11 13" />
                        <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      className={`rbtn ${isChatGenerating ? "generating" : ""}`}
                      title={
                        isChatGenerating
                          ? localizeUi("chat.input.stopGenerating")
                          : localizeUi("ui.noodle.noodlehome.refresh")
                      }
                      onClick={() => {
                        if (isChatGenerating) {
                          handleStopMochiAiGeneration();
                          return;
                        }

                        if (effectiveChatId) {
                          void generate({
                            chatId: effectiveChatId,
                            connectionId: null,
                            ...(promptPresetMode === "engine" && selectedEnginePresetId
                              ? { presetId: selectedEnginePresetId }
                              : {}),
                          });
                        }

                        // Always trigger the Mochi OS local generation too
                        void handleTriggerAiGeneration();
                      }}
                    >
                      {isChatGenerating ? (
                        <svg viewBox="0 0 24 24">
                          <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24">
                          <polyline points="23 4 23 10 17 10" />
                          <polyline points="1 20 1 14 7 14" />
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Group Info Dropdown when pressing group profile */}
                {groupObj && groupInfoOpen && (
                  <>
                    <div className="mochi-group-info-backdrop" onClick={() => setGroupInfoOpen(false)} />
                    <div className="mochi-group-info-popup" onClick={(e) => e.stopPropagation()}>
                      <div className="mochi-group-info-title">{localizeUi("ui.chat.mochiosview.groupInfo")}</div>
                      <div className="mochi-person-info-field">
                        <span className="mochi-person-info-label">{localizeUi("ui.chat.mochiosview.characterId")}</span>
                        <span className="mochi-person-info-value" style={{ fontFamily: "monospace" }}>
                          {groupObj.id}
                        </span>
                      </div>
                      {(() => {
                        const { main, other } = splitMochiGroupMembers(groupObj);
                        return (
                          <>
                            {main.length > 0 && (
                              <div className="mochi-person-info-field">
                                <span className="mochi-person-info-label">
                                  {localizeUi("ui.chat.mochiosview.mainMembers")}
                                </span>
                                <span className="mochi-person-info-value">{main.join(", ")}</span>
                              </div>
                            )}
                            {other.length > 0 && (
                              <div className="mochi-person-info-field">
                                <span className="mochi-person-info-label">
                                  {localizeUi("ui.chat.mochiosview.otherMembers")}
                                </span>
                                <span className="mochi-person-info-value">{other.join(", ")}</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      {groupObj.description && (
                        <div className="mochi-person-info-field">
                          <span className="mochi-person-info-label">
                            {localizeUi("ui.chat.mochiosview.description")}
                          </span>
                          <span className="mochi-person-info-value">{groupObj.description}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* ================= CLOCK SETTINGS MODAL ================= */}
      <div
        className={`overlay ${clockModalOpen ? "show" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setClockModalOpen(false);
        }}
      >
        <div className="modal">
          <div className="modal-head">
            <h3>{localizeUi("ui.chat.mochiosview.clockSettings_f5b2e49")}</h3>
            <button type="button" className="close" onClick={() => setClockModalOpen(false)}>
              ✕
            </button>
          </div>

          <div className="seg">
            <button
              type="button"
              className={clockModalTab === "tz" ? "active" : ""}
              onClick={() => setClockModalTab("tz")}
            >
              {localizeUi("ui.chat.mochiosview.timezone")}
            </button>
            <button
              type="button"
              className={clockModalTab === "custom" ? "active" : ""}
              onClick={() => setClockModalTab("custom")}
            >
              {localizeUi("settings.notifications.customSound.status.custom")}
            </button>
          </div>

          {clockModalTab === "tz" && (
            <div className="panel">
              <span className="lbl">{localizeUi("ui.chat.mochiosview.chooseYourTimezone")}</span>
              <select value={tempTz} onChange={(e) => setTempTz(e.target.value)}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={handleApplyTz}>
                {localizeUi("ui.modals.modeldownloadmodal.apply")}
              </button>
            </div>
          )}

          {clockModalTab === "custom" && (
            <div className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span className="lbl" style={{ margin: 0 }}>
                  {localizeUi("ui.chat.mochiosview.pickADate")}
                </span>
                <button
                  type="button"
                  className={`mochi-ai-decide-btn ${clockAiDecide ? "active" : ""}`}
                  onClick={() => {
                    const next = !clockAiDecide;
                    setClockAiDecide(next);
                    saveSettings({ clockAiDecide: next });
                  }}
                  title={localizeUi("ui.chat.mochiosview.letAiDecide")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: 800,
                    cursor: "pointer",
                    border: clockAiDecide ? "1px solid var(--acc)" : "1px solid var(--line)",
                    background: clockAiDecide ? "var(--acc)" : "var(--input-bg)",
                    color: clockAiDecide ? "#fff" : "var(--muted)",
                    transition: "all 0.18s ease",
                  }}
                >
                  <Sparkles size="0.75rem" />
                  <span>{localizeUi("ui.chat.mochiosview.letAiDecide")}</span>
                  {clockAiDecide && <span style={{ fontSize: 10 }}>✓</span>}
                </button>
              </div>

              <div
                style={{
                  opacity: clockAiDecide ? 0.45 : 1,
                  pointerEvents: clockAiDecide ? "none" : "auto",
                  transition: "opacity 0.2s ease",
                }}
              >
                <div className="cal-head">
                  <button
                    type="button"
                    disabled={clockAiDecide}
                    onClick={() => {
                      const next = new Date(calView);
                      next.setMonth(next.getMonth() - 1);
                      setCalView(next);
                    }}
                  >
                    ‹
                  </button>
                  <strong>
                    {calView.toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                    })}
                  </strong>
                  <button
                    type="button"
                    disabled={clockAiDecide}
                    onClick={() => {
                      const next = new Date(calView);
                      next.setMonth(next.getMonth() + 1);
                      setCalView(next);
                    }}
                  >
                    ›
                  </button>
                </div>

                <div className="cal-grid">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <span key={i} className="dow">
                      {d}
                    </span>
                  ))}
                  {Array.from({ length: calDays.firstDayIndex }).map((_, i) => (
                    <span key={`empty-${i}`} className="cal-day empty" />
                  ))}
                  {Array.from({ length: calDays.totalDays }).map((_, i) => {
                    const dayNum = i + 1;
                    const isSelected =
                      dayNum === calSel.getDate() &&
                      calDays.m === calSel.getMonth() &&
                      calDays.y === calSel.getFullYear();
                    return (
                      <button
                        key={dayNum}
                        type="button"
                        disabled={clockAiDecide}
                        className={`cal-day ${isSelected ? "sel" : ""}`}
                        onClick={() => setCalSel(new Date(calDays.y, calDays.m, dayNum))}
                      >
                        {dayNum}
                      </button>
                    );
                  })}
                </div>

                <span className="lbl">{localizeUi("ui.chat.mochiosview.pickATime")}</span>
                <div className="row">
                  <select value={customHour} disabled={clockAiDecide} onChange={(e) => setCustomHour(+e.target.value)}>
                    {(isHour12 ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : Array.from({ length: 24 }, (_, i) => i)).map(
                      (h) => (
                        <option key={h} value={h}>
                          {two(h)}
                        </option>
                      ),
                    )}
                  </select>
                  <select value={customMin} disabled={clockAiDecide} onChange={(e) => setCustomMin(+e.target.value)}>
                    {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                      <option key={m} value={m}>
                        {two(m)}
                      </option>
                    ))}
                  </select>
                  {isHour12 && (
                    <select
                      value={customAmPm}
                      disabled={clockAiDecide}
                      onChange={(e) => setCustomAmPm(e.target.value as "AM" | "PM")}
                    >
                      <option value="AM">{localizeUi("ui.chat.mochiosview.am")}</option>
                      <option value="PM">{localizeUi("ui.chat.mochiosview.pm")}</option>
                    </select>
                  )}
                </div>
              </div>

              <button type="button" className="btn" style={{ marginTop: 12 }} onClick={handleApplyCustomClock}>
                {localizeUi("ui.modals.modeldownloadmodal.apply")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ================= WEATHER SETTINGS MODAL ================= */}
      <div
        className={`overlay ${wxModalOpen ? "show" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setWxModalOpen(false);
        }}
      >
        <div className="modal">
          <div className="modal-head">
            <h3>{localizeUi("ui.chat.mochiosview.weatherSettings_6bfb0d3")}</h3>
            <button type="button" className="close" onClick={() => setWxModalOpen(false)}>
              ✕
            </button>
          </div>

          <div className="seg">
            <button type="button" className={wxModalTab === "loc" ? "active" : ""} onClick={() => setWxModalTab("loc")}>
              {localizeUi("ui.noodle.noodleprofilesurface.location")}
            </button>
            <button
              type="button"
              className={wxModalTab === "custom" ? "active" : ""}
              onClick={() => setWxModalTab("custom")}
            >
              {localizeUi("settings.notifications.customSound.status.custom")}
            </button>
          </div>

          {wxModalTab === "loc" && (
            <div className="panel">
              <div className="row">
                <input
                  type="text"
                  placeholder={localizeUi("ui.chat.mochiosview.searchCityEGTokyo")}
                  value={wxQuery}
                  onChange={(e) => setWxQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleWxSearch();
                  }}
                />
                <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={handleWxSearch}>
                  {localizeUi("ui.noodle.noodlehome.searchNoodle")}
                </button>
              </div>
              <div className="results">
                {wxSearching && <span className="dim">{localizeUi("ui.modals.docsviewermodal.searching")}</span>}
                {wxResults.map((p, idx) => (
                  <button key={idx} type="button" onClick={() => loadWxData(p.lat, p.lon, p.name)}>
                    {p.name} <span className="dim">{p.region}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="btn ghost" onClick={handleGpsWx} disabled={gpsLoading}>
                {gpsLoading
                  ? localizeUi("ui.chat.mochiosview.locating")
                  : localizeUi("ui.chat.mochiosview.useMyLocationGps")}
              </button>
              {wxErr && <span className="err">{wxErr}</span>}
            </div>
          )}

          {wxModalTab === "custom" && (
            <div className="panel">
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 12 }}>
                <button
                  type="button"
                  className={`mochi-ai-decide-btn ${wxAiDecide ? "active" : ""}`}
                  onClick={() => {
                    const next = !wxAiDecide;
                    setWxAiDecide(next);
                    saveSettings({ wxAiDecide: next });
                  }}
                  title={localizeUi("ui.chat.mochiosview.letAiDecide")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: 800,
                    cursor: "pointer",
                    border: wxAiDecide ? "1px solid var(--acc)" : "1px solid var(--line)",
                    background: wxAiDecide ? "var(--acc)" : "var(--input-bg)",
                    color: wxAiDecide ? "#fff" : "var(--muted)",
                    transition: "all 0.18s ease",
                  }}
                >
                  <Sparkles size="0.75rem" />
                  <span>{localizeUi("ui.chat.mochiosview.letAiDecide")}</span>
                  {wxAiDecide && <span style={{ fontSize: 10 }}>✓</span>}
                </button>
              </div>

              <div
                style={{
                  opacity: wxAiDecide ? 0.45 : 1,
                  pointerEvents: wxAiDecide ? "none" : "auto",
                  transition: "opacity 0.2s ease",
                }}
              >
                <span className="lbl">{localizeUi("ui.noodle.noodleprofilesurface.location")}</span>
                <input
                  type="text"
                  disabled={wxAiDecide}
                  placeholder={localizeUi("ui.chat.mochiosview.eGNewYork")}
                  value={customWxLoc}
                  onChange={(e) => setCustomWxLoc(e.target.value)}
                />
                <span className="lbl">
                  {tempUnit === "F"
                    ? localizeUi("ui.chat.mochiosview.temperatureF")
                    : localizeUi("ui.chat.mochiosview.temperatureC")}
                </span>
                <input
                  type="number"
                  step="0.5"
                  disabled={wxAiDecide}
                  placeholder={
                    tempUnit === "F" ? localizeUi("ui.chat.mochiosview.eG68") : localizeUi("ui.chat.mochiosview.eG20")
                  }
                  value={customWxTemp}
                  onChange={(e) => setCustomWxTemp(e.target.value)}
                />
                <span className="lbl">{localizeUi("ui.chat.mochiosview.condition")}</span>
                <select
                  value={customWxCondChoice}
                  disabled={wxAiDecide}
                  onChange={(e) => setCustomWxCondChoice(e.target.value)}
                >
                  <option value="Sunny">{localizeUi("ui.chat.mochiosview.sunny")}</option>
                  <option value="Partly Cloudy">{localizeUi("ui.chat.mochiosview.partlyCloudy")}</option>
                  <option value="Cloudy">{localizeUi("ui.chat.mochiosview.cloudy")}</option>
                  <option value="Foggy">{localizeUi("ui.chat.mochiosview.foggy")}</option>
                  <option value="Drizzle">{localizeUi("ui.chat.mochiosview.drizzle")}</option>
                  <option value="Rainy">{localizeUi("ui.chat.mochiosview.rainy")}</option>
                  <option value="Showers">{localizeUi("ui.chat.mochiosview.showers")}</option>
                  <option value="Snowy">{localizeUi("ui.chat.mochiosview.snowy")}</option>
                  <option value="Thunderstorm">{localizeUi("ui.chat.mochiosview.thunderstorm")}</option>
                  <option value="__custom">{localizeUi("ui.chat.mochiosview.custom")}</option>
                </select>
                {customWxCondChoice === "__custom" && (
                  <input
                    type="text"
                    disabled={wxAiDecide}
                    placeholder={localizeUi("ui.chat.mochiosview.typeYourConditionEGRainingCats")}
                    value={customWxCondText}
                    onChange={(e) => setCustomWxCondText(e.target.value)}
                  />
                )}
              </div>

              <button type="button" className="btn" style={{ marginTop: 12 }} onClick={handleApplyCustomWx}>
                {localizeUi("ui.modals.modeldownloadmodal.apply")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ================= IMAGES MODAL ================= */}
      <div
        className={`overlay ${imagesModalOpen ? "show" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setImagesModalOpen(false);
        }}
      >
        <div className="modal">
          <div className="modal-head">
            <h3>{localizeUi("ui.noodle.noodlerschedulemanagermodal.images")}</h3>
            <button type="button" className="close" onClick={() => setImagesModalOpen(false)}>
              ✕
            </button>
          </div>

          <div className="seg">
            <button
              type="button"
              className={imagesModalTab === "upload" ? "active" : ""}
              onClick={() => setImagesModalTab("upload")}
            >
              {localizeUi("ui.characters.characterclipcard.upload")}
            </button>
            <button
              type="button"
              className={imagesModalTab === "ai" ? "active" : ""}
              onClick={() => setImagesModalTab("ai")}
            >
              {localizeUi("ui.characters.characterregexsection.ai")}
            </button>
            <button
              type="button"
              className={imagesModalTab === "text" ? "active" : ""}
              onClick={() => setImagesModalTab("text")}
            >
              {localizeUi("ui.chat.chatbranchselector.text")}
            </button>
          </div>

          {imagesModalTab === "upload" && (
            <div className="panel">
              <span className="lbl">{localizeUi("ui.chat.mochiosview.attachFromFiles")}</span>
              <div className="filebox">
                <label className="btn" style={{ cursor: "pointer" }}>
                  {localizeUi("ui.modals.stbulkimportmodal.browse")}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setImgFile(e.target.files[0]);
                      }
                    }}
                  />
                </label>
                <span className="filename">
                  {imgFile ? imgFile.name : localizeUi("ui.chat.mochiosview.noFileSelected")}
                </span>
              </div>
              <span className="lbl">{localizeUi("ui.chat.mochiosview.orPasteAnImageUrl")}</span>
              <input
                type="text"
                placeholder={localizeUi("ui.noodle.noodlehome.https")}
                value={imgUrl}
                onChange={(e) => setImgUrl(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (imgFile || imgUrl) {
                    const imgText = imgFile ? `[Image: ${imgFile.name}]` : `[Image: ${imgUrl}]`;
                    setImagesModalOpen(false);
                    setImgFile(null);
                    setImgUrl("");
                    void handleSendText(imgText);
                  }
                }}
              >
                {localizeUi("ui.chat.homeprofessormarichat.attachChatHistoryAttach")}
              </button>
            </div>
          )}

          {imagesModalTab === "ai" && (
            <div className="panel">
              <span className="lbl">{localizeUi("ui.chat.mochiosview.describeWhatYouWantAiToGenerate")}</span>
              <input
                type="text"
                placeholder={localizeUi("ui.chat.mochiosview.eGACatWearingSunglasses")}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
              <span className="lbl">{localizeUi("ui.chat.mochiosview.selectCharacterFromContacts")}</span>
              <input
                type="text"
                placeholder={localizeUi("ui.chat.mochiosview.searchContacts")}
                value={aiSearch}
                onChange={(e) => setAiSearch(e.target.value)}
              />
              <div className="contact-pick">
                {Object.values(currentContactsMap)
                  .filter((c) => !aiSearch || c.name.toLowerCase().includes(aiSearch.toLowerCase()))
                  .map((c) => {
                    const isSelected = aiSelectedNames.includes(c.name);
                    return (
                      <button
                        key={c.name}
                        type="button"
                        className={`cpick ${isSelected ? "on" : ""}`}
                        onClick={() => {
                          setAiSelectedNames((prev) =>
                            isSelected ? prev.filter((n) => n !== c.name) : [...prev, c.name],
                          );
                        }}
                      >
                        <span className="dot" style={{ "--c": c.color } as React.CSSProperties}>
                          {c.name[0]}
                        </span>
                        {c.name}
                      </button>
                    );
                  })}
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const prompt = aiPrompt.trim();
                  const names = aiSelectedNames.join(", ");
                  if (prompt) {
                    const aiImgText = `[AI Image: ${prompt}${names ? ` (${names})` : ""}]`;
                    setImagesModalOpen(false);
                    setAiPrompt("");
                    setAiSelectedNames([]);
                    void handleSendText(aiImgText);
                  }
                }}
              >
                {localizeUi("ui.characters.characterclipcard.generate")}
              </button>
            </div>
          )}

          {imagesModalTab === "text" && (
            <div className="panel">
              <span className="lbl">{localizeUi("ui.chat.mochiosview.describeTheImageYouReSending")}</span>
              <input
                type="text"
                placeholder={localizeUi("ui.chat.mochiosview.whatDoesItLookLike")}
                value={imgDescription}
                onChange={(e) => setImgDescription(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const desc = imgDescription.trim();
                  if (desc) {
                    const descText = `[Image Description: ${desc}]`;
                    setImagesModalOpen(false);
                    setImgDescription("");
                    void handleSendText(descText);
                  }
                }}
              >
                {localizeUi("ui.chat.mochiosview.sendDescription")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ================= APP STORE WINDOW ================= */}
      <div className={`app-store-window ${appStoreOpen ? "open" : ""}`}>
        <div className="app-store-header">
          <div className="app-store-header-left">
            <button
              type="button"
              className="icon-btn app-store-back-btn"
              title={localizeUi("ui.chat.mochiosview.backToHome")}
              onClick={() => setAppStoreOpen(false)}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                stroke="currentColor"
                fill="none"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="app-store-title-wrap">
              <h2>
                {localizeUi("ui.chat.mochiosview.appStore")}
                <span className="app-store-header-tag">{localizeUi("ui.chat.mochiosview.os20")}</span>
              </h2>
              <span className="app-store-subtitle">{localizeUi("ui.chat.mochiosview.appStoreSubtitle")}</span>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn app-store-close-btn"
            title={localizeUi("ui.chat.mochiosview.cancel")}
            onClick={() => setAppStoreOpen(false)}
          >
            ✕
          </button>
        </div>

        <div className="app-store-body">
          {/* Search bar */}
          <div className="app-store-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={localizeUi("ui.chat.mochiosview.searchAppsGamesStoriesTools")}
              value={appStoreSearch}
              onChange={(e) => setAppStoreSearch(e.target.value)}
            />
            {appStoreSearch && (
              <button
                type="button"
                className="icon-btn app-store-search-clear"
                onClick={() => setAppStoreSearch("")}
                aria-label={localizeUi("ui.chat.mochiosview.clearSearch")}
              >
                ✕
              </button>
            )}
          </div>

          {/* Featured Hero Banner */}
          {!appStoreSearch && appStoreCategory === "all" && (
            <div className="app-store-hero">
              <div className="app-store-hero-content">
                <span className="app-store-hero-pill">
                  <span className="app-store-sparkle">✦</span>
                  {localizeUi("ui.chat.mochiosview.featuredDiscovery")}
                </span>
                <h3>{localizeUi("ui.chat.mochiosview.mochiMessengerLiveVoice")}</h3>
                <p>{localizeUi("ui.chat.mochiosview.connectWithYourAiCompanionsCustomizeRealTimePersonas")}</p>
                <div className="app-store-hero-actions">
                  <button
                    type="button"
                    className="app-store-hero-action"
                    onClick={() => {
                      setAppStoreOpen(false);
                      setIsPrivateMode(false);
                      setMessagesAppOpen(true);
                    }}
                  >
                    {localizeUi("ui.chat.mochiosview.openMessenger")}
                  </button>
                  <span className="app-store-hero-badge">{localizeUi("ui.chat.mochiosview.preInstalled")}</span>
                </div>
              </div>
            </div>
          )}

          {/* Categories */}
          <div className="app-store-categories">
            {APP_STORE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`app-store-category-chip ${appStoreCategory === cat.id ? "active" : ""}`}
                aria-pressed={appStoreCategory === cat.id}
                onClick={() => setAppStoreCategory(cat.id)}
              >
                <span className="app-store-chip-icon" aria-hidden="true">
                  {cat.icon}
                </span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>

          {/* App Catalog Grid */}
          <div className="app-store-section">
            <div className="app-store-section-title">
              <span>{localizeUi("ui.chat.mochiosview.popularOnMochiOs")}</span>
              <span className="app-store-item-count">
                {localizeUi("ui.chat.mochiosview.appsCount", { count: visibleStoreApps.length })}
              </span>
            </div>
            {visibleStoreApps.length === 0 ? (
              <div className="app-store-empty">
                <span className="app-store-empty-mark" aria-hidden="true">
                  ◍
                </span>
                <p className="app-store-empty-title">{localizeUi("ui.chat.mochiosview.noAppsMatchSearch")}</p>
                <p className="app-store-empty-body">{localizeUi("ui.chat.mochiosview.noAppsMatchSearchHint")}</p>
                <button
                  type="button"
                  className="app-store-empty-action"
                  onClick={() => {
                    setAppStoreSearch("");
                    setAppStoreCategory("all");
                  }}
                >
                  {localizeUi("ui.chat.mochiosview.showAllApps")}
                </button>
              </div>
            ) : (
              <div className="app-store-grid">
                {visibleStoreApps.map((app) => {
                  const isInstalled = !!installedApps[app.id];
                  return (
                    <div key={app.id} className="app-store-card">
                      <div className="app-store-card-left">
                        <div className={`app-store-card-icon tone-${app.tone}`}>{app.icon}</div>
                        <div className="app-store-card-info">
                          <div className="app-store-card-title-row">
                            <h4 className="app-store-card-name">{app.name}</h4>
                            <span className="app-store-card-tag">{app.category}</span>
                          </div>
                          <p className="app-store-card-desc">{app.desc}</p>
                          <div className="app-store-card-meta">
                            <span className="app-store-rating">
                              <span className="app-store-star" aria-hidden="true">
                                ★
                              </span>
                              4.9
                            </span>
                            <span className="app-store-meta-dot" aria-hidden="true">
                              •
                            </span>
                            <span>
                              {isInstalled
                                ? localizeUi("ui.chat.mochiosview.installed")
                                : localizeUi("ui.chat.mochiosview.free")}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`app-store-card-btn ${isInstalled ? "installed" : "get"}`}
                        onClick={() => {
                          if (app.id === "messages") {
                            setAppStoreOpen(false);
                            setIsPrivateMode(false);
                            setMessagesAppOpen(true);
                          } else {
                            setInstalledApps((prev) => ({
                              ...prev,
                              [app.id]: !prev[app.id],
                            }));
                          }
                        }}
                      >
                        {isInstalled
                          ? localizeUi("ui.chat.activelorebookentryrow.open")
                          : localizeUi("ui.chat.mochiosview.get")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================= SETTINGS MODAL (MASTER-DETAIL / SPLIT-VIEW) ================= */}
      {settingsModalOpen && <div
        className="overlay show"
        onClick={(e) => {
          if (e.target === e.currentTarget) setSettingsModalOpen(false);
        }}
      >
        <div className="modal modal-settings-split">
          <div className="settings-split-head">
            <h3>{localizeUi("navigation.topbar.settings")}</h3>
            <button type="button" className="close" onClick={() => setSettingsModalOpen(false)}>
              ✕
            </button>
          </div>

          <MochiSettingsSplit>
            {/* Left Pane (Master/Navigation) */}
            <div className="settings-split-sidebar">
              <button
                type="button"
                className={`settings-nav-item ${settingsActiveTab === "appearance" ? "active" : ""}`}
                onClick={() => setSettingsActiveTab("appearance")}
              >
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
                <span>{localizeUi("chat.settings.inlineEditor.fields.appearance")}</span>
              </button>

              <button
                type="button"
                className={`settings-nav-item ${settingsActiveTab === "api" ? "active" : ""}`}
                onClick={() => setSettingsActiveTab("api")}
              >
                <svg viewBox="0 0 24 24"><path d="M8 3v4m8-4v4M6 7h12v4a6 6 0 0 1-6 6v4m0-4a6 6 0 0 1-6-6z" /></svg>
                <span>API</span>
              </button>

              <button
                type="button"
                className={`settings-nav-item ${settingsActiveTab === "preset" ? "active" : ""}`}
                onClick={() => setSettingsActiveTab("preset")}
              >
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                  <path d="M14 9h4" />
                  <path d="M14 15h4" />
                </svg>
                <span>{localizeUi("ui.chat.mochiosview.aiPreset")}</span>
              </button>

              <button
                type="button"
                className={`settings-nav-item ${settingsActiveTab === "format_guides" ? "active" : ""}`}
                onClick={() => setSettingsActiveTab("format_guides")}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <span>{localizeUi("ui.chat.mochiosview.formatGuides")}</span>
              </button>

              <button
                type="button"
                className={`settings-nav-item ${settingsActiveTab === "about" ? "active" : ""}`}
                onClick={() => setSettingsActiveTab("about")}
              >
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>{localizeUi("ui.characters.metadatatab.version")}</span>
              </button>
            </div>

            {/* Right Pane (Detail/Content) */}
            <div className="settings-split-content">
              {settingsActiveTab === "api" && <MochiApiSettings />}
              {settingsActiveTab === "appearance" && (
                <div className="panel">
                  <div className="settings-section-title">
                    {localizeUi("chat.settings.inlineEditor.fields.appearance")}
                  </div>

                  <span className="lbl">{localizeUi("ui.chat.mochiosview.theme")}</span>
                  <div className="seg">
                    <button
                      type="button"
                      className={theme === "auto" ? "active" : ""}
                      onClick={() => {
                        setTheme("auto");
                        saveSettings({ theme: "auto" });
                      }}
                    >
                      {localizeUi("ui.chat.characterspanel.auto")}
                    </button>
                    <button
                      type="button"
                      className={theme === "light" ? "active" : ""}
                      onClick={() => {
                        setTheme("light");
                        saveSettings({ theme: "light" });
                      }}
                    >
                      {localizeUi("ui.panels.appearancesettings.light")}
                    </button>
                    <button
                      type="button"
                      className={theme === "dark" ? "active" : ""}
                      onClick={() => {
                        setTheme("dark");
                        saveSettings({ theme: "dark" });
                      }}
                    >
                      {localizeUi("ui.panels.appearancesettings.dark")}
                    </button>
                  </div>

                  <span className="lbl">{localizeUi("ui.ui.spritewandcleanupeditor.color")}</span>
                  <div className="color-picker">
                    <button
                      type="button"
                      className={`color-btn ${colorPreset === "" ? "active" : ""}`}
                      style={{ "--c": "#7fa061" } as React.CSSProperties}
                      aria-label={localizeUi("ui.chat.mochiosview.colorDefault")}
                      aria-pressed={colorPreset === ""}
                      onClick={() => {
                        setColorPreset("");
                        saveSettings({ colorPreset: "" });
                      }}
                    />
                    <button
                      type="button"
                      className={`color-btn ${colorPreset === "ocean" ? "active" : ""}`}
                      style={{ "--c": "#6fa2cc" } as React.CSSProperties}
                      aria-label={localizeUi("ui.chat.mochiosview.colorOcean")}
                      aria-pressed={colorPreset === "ocean"}
                      onClick={() => {
                        setColorPreset("ocean");
                        saveSettings({ colorPreset: "ocean" });
                      }}
                    />
                    <button
                      type="button"
                      className={`color-btn ${colorPreset === "plum" ? "active" : ""}`}
                      style={{ "--c": "#b57fb8" } as React.CSSProperties}
                      aria-label={localizeUi("ui.chat.mochiosview.colorPlum")}
                      aria-pressed={colorPreset === "plum"}
                      onClick={() => {
                        setColorPreset("plum");
                        saveSettings({ colorPreset: "plum" });
                      }}
                    />
                    <button
                      type="button"
                      className={`color-btn ${colorPreset === "peach" ? "active" : ""}`}
                      style={{ "--c": "#d98e71" } as React.CSSProperties}
                      aria-label={localizeUi("ui.chat.mochiosview.colorPeach")}
                      aria-pressed={colorPreset === "peach"}
                      onClick={() => {
                        setColorPreset("peach");
                        saveSettings({ colorPreset: "peach" });
                      }}
                    />
                    <div className="color-custom-wrap">
                      <button
                        type="button"
                        className={`color-btn custom ${colorPreset === "custom" ? "active" : ""}`}
                        aria-label={localizeUi("ui.chat.mochiosview.customColor")}
                        aria-pressed={colorPreset === "custom"}
                        style={
                          colorPreset === "custom"
                            ? ({
                                "--c": resolveMochiCustomAccent(customColorHex, resolvedTheme),
                              } as React.CSSProperties)
                            : {}
                        }
                        onClick={() => {
                          setColorPreset("custom");
                          saveSettings({ colorPreset: "custom" });
                        }}
                      >
                        {colorPreset !== "custom" && (
                          <svg viewBox="0 0 24 24">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {colorPreset === "custom" && (
                    <MochiColorPicker hex={customColorHex} mode={resolvedTheme} onChange={handleCustomColorChange} />
                  )}

                  <span className="lbl">{localizeUi("ui.chat.mochiosview.timeFormat")}</span>
                  <div className="seg">
                    <button
                      type="button"
                      className={timeFormat === "12h" ? "active" : ""}
                      onClick={() => {
                        setTimeFormat("12h");
                        saveSettings({ timeFormat: "12h" });
                      }}
                    >
                      {localizeUi("ui.chat.mochiosview.text12Hour")}
                    </button>
                    <button
                      type="button"
                      className={timeFormat === "24h" ? "active" : ""}
                      onClick={() => {
                        setTimeFormat("24h");
                        saveSettings({ timeFormat: "24h" });
                      }}
                    >
                      {localizeUi("ui.chat.mochiosview.text24Hour")}
                    </button>
                  </div>

                  <span className="lbl">{localizeUi("ui.panels.trackerpanelappearancedrawer.temperatureUnit")}</span>
                  <div className="seg">
                    <button
                      type="button"
                      className={tempUnit === "C" ? "active" : ""}
                      onClick={() => {
                        setTempUnit("C");
                        saveSettings({ tempUnit: "C" });
                      }}
                    >
                      {localizeUi("ui.chat.mochiosview.celsiusC")}
                    </button>
                    <button
                      type="button"
                      className={tempUnit === "F" ? "active" : ""}
                      onClick={() => {
                        setTempUnit("F");
                        saveSettings({ tempUnit: "F" });
                      }}
                    >
                      {localizeUi("ui.chat.mochiosview.fahrenheitF")}
                    </button>
                  </div>

                </div>
              )}

              {settingsActiveTab === "preset" && (
                <div className="panel">
                  <div className="settings-panel-header-clean">
                    <div>
                      <div className="settings-section-title" style={{ marginBottom: 2 }}>
                        {localizeUi("ui.chat.mochiosview.aiPreset")}
                      </div>
                      <div className="settings-section-subtitle">
                        {localizeUi("ui.chat.mochiosview.aiPresetSubtitle")}
                      </div>
                    </div>
                    <div className="settings-toolbar-actions">
                      <label className="settings-icon-btn" title={localizeUi("ui.chat.mochiosview.uploadPresetJson")}>
                        <svg
                          viewBox="0 0 24 24"
                          width="15"
                          height="15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <input
                          type="file"
                          accept=".json,application/json"
                          hidden
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                const text = event.target?.result as string;
                                if (text) {
                                  try {
                                    const parsed = JSON.parse(text);
                                    const formatted = JSON.stringify(parsed, null, 2);
                                    setCustomPresetJsonDraft(formatted);
                                    saveSettings({ promptPresetMode: "custom", customPresetJson: formatted });
                                    setPromptPresetMode("custom");
                                  } catch {
                                    setCustomPresetJsonDraft(text);
                                    saveSettings({ promptPresetMode: "custom", customPresetJson: text });
                                    setPromptPresetMode("custom");
                                  }
                                }
                              };
                              reader.readAsText(e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="settings-icon-btn"
                        title={localizeUi("ui.chat.mochiosview.exportPresetJson")}
                        onClick={() => {
                          const blob = new Blob([customPresetJsonDraft || DEFAULT_MOCHI_PRESET_JSON], {
                            type: "application/json",
                          });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "mochi_os_preset.json";
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="15"
                          height="15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="settings-icon-btn"
                        title={localizeUi("ui.chat.mochiosview.resetPresetDefault")}
                        onClick={() => {
                          setCustomPresetJsonDraft(DEFAULT_MOCHI_PRESET_JSON);
                          saveSettings({ promptPresetMode: "default", customPresetJson: DEFAULT_MOCHI_PRESET_JSON });
                          setPromptPresetMode("default");
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="15"
                          height="15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="seg" style={{ marginBottom: 14 }}>
                    <button
                      type="button"
                      className={promptPresetMode === "default" ? "active" : ""}
                      onClick={() => {
                        setPromptPresetMode("default");
                        saveSettings({ promptPresetMode: "default" });
                      }}
                    >
                      {localizeUi("ui.chat.mochiosview.presetModeDefault")}
                    </button>
                    <button
                      type="button"
                      className={promptPresetMode === "custom" ? "active" : ""}
                      onClick={() => {
                        setPromptPresetMode("custom");
                        saveSettings({ promptPresetMode: "custom" });
                      }}
                    >
                      {localizeUi("ui.chat.mochiosview.presetModeBlocks")}
                    </button>
                    <button
                      type="button"
                      className={promptPresetMode === "engine" ? "active" : ""}
                      onClick={() => {
                        setPromptPresetMode("engine");
                        saveSettings({ promptPresetMode: "engine" });
                      }}
                    >
                      {localizeUi("ui.chat.mochiosview.presetModeEngine")}
                    </button>
                  </div>

                  {promptPresetMode === "engine" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="lbl">{localizeUi("ui.chat.mochiosview.selectEnginePreset")}</span>
                      <select
                        value={selectedEnginePresetId || ""}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          setSelectedEnginePresetId(val);
                          saveSettings({ selectedEnginePresetId: val });
                        }}
                      >
                        <option value="">{localizeUi("ui.chat.mochiosview.defaultUniversalPreset")}</option>
                        {enginePresets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {promptPresetMode === "custom" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {(() => {
                        let parsedPreset: { name?: string; blocks?: Array<Record<string, any>> } = DEFAULT_MOCHI_PRESET;
                        try {
                          parsedPreset = JSON.parse(customPresetJsonDraft || DEFAULT_MOCHI_PRESET_JSON);
                        } catch {
                          parsedPreset = DEFAULT_MOCHI_PRESET;
                        }

                        const updateBlocks = (nextBlocks: Array<Record<string, any>>) => {
                          const nextPreset = { ...parsedPreset, blocks: nextBlocks };
                          const str = JSON.stringify(nextPreset, null, 2);
                          setCustomPresetJsonDraft(str);
                          saveSettings({ customPresetJson: str });
                        };

                        return (
                          <>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span className="lbl" style={{ margin: 0 }}>
                                {localizeUi("ui.chat.mochiosview.presetBlocksCount", {
                                  count: parsedPreset.blocks?.length ?? 0,
                                })}
                              </span>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => {
                                    const newBlock = {
                                      id: `custom_${Date.now()}`,
                                      identifier: `section_${Date.now()}`,
                                      name: `BLOCK_${(parsedPreset.blocks?.length ?? 0) + 1}`,
                                      role: "system" as const,
                                      content: "",
                                      isMarker: false,
                                      enabled: true,
                                    };
                                    updateBlocks([...(parsedPreset.blocks ?? []), newBlock]);
                                  }}
                                >
                                  + {localizeUi("ui.chat.mochiosview.addBlock")}
                                </button>
                                <select
                                  className="btn btn-sm"
                                  style={{
                                    cursor: "pointer",
                                    width: "auto",
                                    background: "var(--paper-dim)",
                                    color: "var(--text)",
                                    border: "1px solid var(--bubble-line)",
                                  }}
                                  value=""
                                  onChange={(e) => {
                                    const opt = MOCHI_MARKER_OPTIONS.find((m) => m.type === e.target.value);
                                    if (!opt) return;
                                    const markerBlock = {
                                      id: `marker_${Date.now()}`,
                                      identifier: opt.type,
                                      name: opt.label,
                                      role: opt.role,
                                      content: "",
                                      isMarker: true,
                                      markerConfig: { type: opt.type as any },
                                      enabled: true,
                                    };
                                    updateBlocks([...(parsedPreset.blocks ?? []), markerBlock]);
                                    e.target.value = "";
                                  }}
                                >
                                  <option value="" disabled>
                                    + {localizeUi("ui.chat.mochiosview.addMarker")}
                                  </option>
                                  {MOCHI_MARKER_OPTIONS.map((opt) => (
                                    <option key={opt.type} value={opt.type}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div className="preset-blocks-container">
                              {parsedPreset.blocks?.map((block, bIdx) => {
                                const isMarker = block.isMarker === true || !!block.markerConfig;
                                const markerOpt = isMarker
                                  ? MOCHI_MARKER_OPTIONS.find(
                                      (m) => m.type === (block.markerConfig?.type || block.identifier),
                                    )
                                  : null;

                                return (
                                  <div
                                    key={block.id || bIdx}
                                    className={`preset-block-card ${draggedBlockIdx === bIdx ? "dragging" : ""} ${
                                      dragOverBlockIdx === bIdx ? "drag-over" : ""
                                    }`}
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = "move";
                                      if (dragOverBlockIdx !== bIdx) {
                                        setDragOverBlockIdx(bIdx);
                                      }
                                    }}
                                    onDragLeave={() => {
                                      if (dragOverBlockIdx === bIdx) {
                                        setDragOverBlockIdx(null);
                                      }
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      setDragOverBlockIdx(null);
                                      if (draggedBlockIdx === null || draggedBlockIdx === bIdx) return;
                                      const next = [...(parsedPreset.blocks ?? [])];
                                      const [moved] = next.splice(draggedBlockIdx, 1);
                                      if (moved) {
                                        next.splice(bIdx, 0, moved);
                                        updateBlocks(next);
                                      }
                                      setDraggedBlockIdx(null);
                                    }}
                                  >
                                    <div className="preset-block-header">
                                      <div className="preset-block-title-group">
                                        <span
                                          className="preset-drag-handle"
                                          title={localizeUi("ui.lorebooks.lorebookentryrow.dragToReorder")}
                                          draggable
                                          onDragStart={(e) => {
                                            setDraggedBlockIdx(bIdx);
                                            e.dataTransfer.effectAllowed = "move";
                                            e.dataTransfer.setData("text/plain", String(bIdx));
                                          }}
                                          onDragEnd={() => {
                                            setDraggedBlockIdx(null);
                                            setDragOverBlockIdx(null);
                                          }}
                                        >
                                          <svg
                                            viewBox="0 0 24 24"
                                            width="14"
                                            height="14"
                                            stroke="currentColor"
                                            fill="none"
                                            strokeWidth="2.5"
                                          >
                                            <circle cx="9" cy="6" r="1.2" fill="currentColor" />
                                            <circle cx="9" cy="12" r="1.2" fill="currentColor" />
                                            <circle cx="9" cy="18" r="1.2" fill="currentColor" />
                                            <circle cx="15" cy="6" r="1.2" fill="currentColor" />
                                            <circle cx="15" cy="12" r="1.2" fill="currentColor" />
                                            <circle cx="15" cy="18" r="1.2" fill="currentColor" />
                                          </svg>
                                        </span>
                                        {isMarker ? (
                                          <span className="preset-marker-tag">
                                            🏷 {block.name || markerOpt?.label || "Marker"}
                                          </span>
                                        ) : (
                                          <input
                                            type="text"
                                            className="preset-block-name-input"
                                            value={block.name || ""}
                                            onChange={(e) => {
                                              const next = [...(parsedPreset.blocks ?? [])];
                                              next[bIdx] = { ...next[bIdx], name: e.target.value };
                                              updateBlocks(next);
                                            }}
                                            placeholder={localizeUi("ui.chat.mochiosview.blockName")}
                                          />
                                        )}
                                        <select
                                          className="preset-role-select"
                                          value={block.role || "system"}
                                          onChange={(e) => {
                                            const next = [...(parsedPreset.blocks ?? [])];
                                            next[bIdx] = {
                                              ...next[bIdx],
                                              role: e.target.value as "system" | "user" | "assistant",
                                            };
                                            updateBlocks(next);
                                          }}
                                        >
                                          <option value="system">{localizeUi("ui.chat.mochiosview.system")}</option>
                                          <option value="user">{localizeUi("ui.chat.mochiosview.user")}</option>
                                          <option value="assistant">
                                            {localizeUi("ui.chat.mochiosview.assistant")}
                                          </option>
                                        </select>
                                      </div>

                                      <div className="preset-block-actions">
                                        <button
                                          type="button"
                                          className="preset-del-btn"
                                          title={localizeUi("ui.chat.mochiosview.deleteBlock")}
                                          onClick={() => {
                                            const next = (parsedPreset.blocks ?? []).filter((_, idx) => idx !== bIdx);
                                            updateBlocks(next);
                                          }}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </div>

                                    {isMarker ? (
                                      <div className="preset-marker-desc">
                                        {markerOpt?.desc ||
                                          "Automated dynamic marker expanded at prompt assembly time."}
                                      </div>
                                    ) : (
                                      <textarea
                                        className="preset-block-textarea"
                                        value={block.content || ""}
                                        placeholder={localizeUi(
                                          "ui.chat.mochiosview.enterPromptInstructionsSupportsUserCharMacros",
                                        )}
                                        onChange={(e) => {
                                          const next = [...(parsedPreset.blocks ?? [])];
                                          next[bIdx] = { ...next[bIdx], content: e.target.value };
                                          updateBlocks(next);
                                        }}
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {promptPresetMode === "default" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="lbl" style={{ margin: 0 }}>
                          {DEFAULT_MOCHI_PRESET.name} ·{" "}
                          {localizeUi("ui.chat.mochiosview.presetBlocksCount", {
                            count: DEFAULT_MOCHI_PRESET.blocks.length,
                          })}
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            setCustomPresetJsonDraft(DEFAULT_MOCHI_PRESET_JSON);
                            setPromptPresetMode("custom");
                            saveSettings({ promptPresetMode: "custom", customPresetJson: DEFAULT_MOCHI_PRESET_JSON });
                          }}
                        >
                          ✏️ {localizeUi("ui.noodle.ambientProfiles.edit")}
                        </button>
                      </div>

                      <div className="preset-blocks-container">
                        {DEFAULT_MOCHI_PRESET.blocks.map((block, bIdx) => {
                          const isMarker = block.isMarker === true || !!block.markerConfig;
                          const markerOpt = isMarker
                            ? MOCHI_MARKER_OPTIONS.find(
                                (m) => m.type === (block.markerConfig?.type || block.identifier),
                              )
                            : null;

                          return (
                            <div key={block.id || bIdx} className="preset-block-card">
                              <div className="preset-block-header">
                                <div className="preset-block-title-group">
                                  {isMarker ? (
                                    <span className="preset-marker-tag">
                                      🏷 {block.name || markerOpt?.label || "Marker"}
                                    </span>
                                  ) : (
                                    <b style={{ fontSize: 13, color: "var(--text)" }}>{block.name}</b>
                                  )}
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      fontWeight: 800,
                                      textTransform: "uppercase",
                                      padding: "2px 6px",
                                      borderRadius: 6,
                                      background: "var(--input-bg)",
                                      color: "var(--muted)",
                                    }}
                                  >
                                    {block.role}
                                  </span>
                                </div>
                              </div>

                              {isMarker ? (
                                <div className="preset-marker-desc">
                                  {markerOpt?.desc || "Automated dynamic marker expanded at prompt assembly time."}
                                </div>
                              ) : (
                                <textarea
                                  className="preset-block-textarea"
                                  readOnly
                                  value={block.content || ""}
                                  placeholder={localizeUi("ui.chat.mochiosview.presetBlockContent")}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {settingsActiveTab === "format_guides" && (
                <div className="panel">
                  <div className="settings-panel-header-clean">
                    <div>
                      <div className="settings-section-title" style={{ marginBottom: 2 }}>
                        {localizeUi("ui.chat.mochiosview.formatGuides")}
                      </div>
                      <div className="settings-section-subtitle">
                        {localizeUi("ui.chat.mochiosview.formatGuidesSubtitle")}
                      </div>
                    </div>
                    <div className="settings-toolbar-actions">
                      <label className="settings-icon-btn" title={localizeUi("ui.chat.mochiosview.formatGuideImport")}>
                        <svg
                          viewBox="0 0 24 24"
                          width="15"
                          height="15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <input
                          type="file"
                          accept=".json,application/json"
                          hidden
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                const text = event.target?.result as string;
                                if (text) {
                                  try {
                                    const parsed = JSON.parse(text);
                                    if (parsed.formatGuide) {
                                      const normalized = normalizeMochiFormatGuides(parsed);
                                      setFormatGuidesDraft(normalized);
                                      saveSettings({ formatGuidesJson: JSON.stringify(normalized) });
                                    }
                                  } catch (err) {
                                    console.error("Invalid format guide JSON", err);
                                  }
                                }
                              };
                              reader.readAsText(e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="settings-icon-btn"
                        title={localizeUi("ui.chat.mochiosview.formatGuideExport")}
                        onClick={() => {
                          const blob = new Blob([JSON.stringify(formatGuidesDraft, null, 2)], {
                            type: "application/json",
                          });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `mochi_format_guides_${Date.now()}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="15"
                          height="15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="settings-icon-btn"
                        title={localizeUi("ui.chat.mochiosview.resetPresetDefault")}
                        onClick={() => {
                          setFormatGuidesDraft(DEFAULT_FORMAT_GUIDES);
                          saveSettings({ formatGuidesJson: JSON.stringify(DEFAULT_FORMAT_GUIDES) });
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="15"
                          height="15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Filter & Search Toolbar */}
                  <div className="format-guides-filter-bar">
                    <div className="format-guide-search-wrap">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <input
                        type="text"
                        className="format-guide-search-input"
                        placeholder={localizeUi("ui.chat.mochiosview.searchFormatGuides")}
                        value={formatGuidesSearchQuery}
                        onChange={(e) => setFormatGuidesSearchQuery(e.target.value)}
                      />
                      {formatGuidesSearchQuery && (
                        <button
                          type="button"
                          className="format-guide-search-clear"
                          onClick={() => setFormatGuidesSearchQuery("")}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div className="format-guides-category-pills">
                      <button
                        type="button"
                        className={`format-guide-pill ${formatGuidesCategory === "general" ? "active" : ""}`}
                        onClick={() => setFormatGuidesCategory("general")}
                      >
                        {localizeUi("ui.chat.mochiosview.formatGuidesGeneral")}{" "}
                        <span className="pill-count">{FORMAT_GUIDE_ITEMS_GENERAL.length}</span>
                      </button>
                      <button
                        type="button"
                        className={`format-guide-pill ${formatGuidesCategory === "drawing_tags" ? "active" : ""}`}
                        onClick={() => setFormatGuidesCategory("drawing_tags")}
                      >
                        {localizeUi("ui.chat.mochiosview.formatGuidesDrawingTags")}{" "}
                        <span className="pill-count">{FORMAT_GUIDE_ITEMS_DRAWING_TAGS.length}</span>
                      </button>
                      <button
                        type="button"
                        className={`format-guide-pill ${formatGuidesCategory === "drawing_natural" ? "active" : ""}`}
                        onClick={() => setFormatGuidesCategory("drawing_natural")}
                      >
                        {localizeUi("ui.chat.mochiosview.formatGuidesDrawingNatural")}{" "}
                        <span className="pill-count">{FORMAT_GUIDE_ITEMS_DRAWING_NATURAL.length}</span>
                      </button>
                    </div>

                  </div>

                  {/* Accordion / Cards List */}
                  <div className="format-guides-cards-list">
                    {(() => {
                      const allItems: FormatGuideMeta[] =
                        formatGuidesCategory === "general"
                          ? FORMAT_GUIDE_ITEMS_GENERAL
                          : formatGuidesCategory === "drawing_tags"
                            ? FORMAT_GUIDE_ITEMS_DRAWING_TAGS
                            : FORMAT_GUIDE_ITEMS_DRAWING_NATURAL;

                      const q = formatGuidesSearchQuery.trim().toLowerCase();
                      const items = q
                        ? allItems.filter((it) => it.name.toLowerCase().includes(q) || it.key.toLowerCase().includes(q))
                        : allItems;

                      if (items.length === 0) {
                        return (
                          <div className="format-guides-empty-state">
                            <i className="fa-solid fa-magnifying-glass" style={{ fontSize: 24, opacity: 0.4 }} />
                            <span>{localizeUi("ui.chat.mochiosview.noMatchingGuides")}</span>
                          </div>
                        );
                      }

                      return items.map((item) => {
                        const isExpanded = expandedGuideKey === item.key;
                        const contentValue =
                          formatGuidesCategory === "general"
                            ? (formatGuidesDraft.formatGuide[item.key] ?? "")
                            : formatGuidesCategory === "drawing_tags"
                              ? (formatGuidesDraft.formatGuideDrawing?.tags?.[item.key] ?? "")
                              : (formatGuidesDraft.formatGuideDrawing?.natural?.[item.key] ?? "");

                        const defaultContentValue =
                          formatGuidesCategory === "general"
                            ? (DEFAULT_FORMAT_GUIDES.formatGuide[item.key] ?? "")
                            : formatGuidesCategory === "drawing_tags"
                              ? (DEFAULT_FORMAT_GUIDES.formatGuideDrawing.tags[item.key] ?? "")
                              : (DEFAULT_FORMAT_GUIDES.formatGuideDrawing.natural[item.key] ?? "");

                        const isModified = contentValue !== defaultContentValue;

                        return (
                          <div key={item.key} className={`format-guide-accordion-card ${isExpanded ? "expanded" : ""}`}>
                            <div
                              className="format-guide-card-header"
                              onClick={() => setExpandedGuideKey(isExpanded ? null : item.key)}
                            >
                              <div className="format-guide-card-header-left">
                                <div className="format-guide-icon-box">
                                  <i className={`fa-solid ${item.icon}`} />
                                </div>
                                <div className="format-guide-card-title-wrap">
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span className="format-guide-card-title">{item.name}</span>
                                    {isModified && (
                                      <span className="format-guide-modified-badge">
                                        {localizeUi("ui.chat.mochiosview.modified")}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="format-guide-card-header-right" onClick={(e) => e.stopPropagation()}>
                                <span className="format-guide-chars-badge">
                                  {localizeUi("ui.chat.mochiosview.charsCount", { count: contentValue.length })}
                                </span>

                                {isExpanded && (
                                  <div className="format-guide-header-buttons">
                                    <button
                                      type="button"
                                      className="btn btn-sm format-guide-copy-btn"
                                      title={localizeUi(copiedGuideKey === item.key ? "ui.chat.mochiosview.formatGuideCopied" : "ui.chat.mochiosview.formatGuideCopy")}
                                      aria-label={localizeUi(copiedGuideKey === item.key ? "ui.chat.mochiosview.formatGuideCopied" : "ui.chat.mochiosview.formatGuideCopy")}
                                      onClick={() => {
                                        navigator.clipboard.writeText(contentValue);
                                        setCopiedGuideKey(item.key);
                                        setTimeout(() => setCopiedGuideKey(null), 2000);
                                      }}
                                    >
                                      <span aria-hidden="true">📋</span>
                                    </button>
                                    {isModified && (
                                      <button
                                        type="button"
                                        className="btn btn-sm"
                                        onClick={() => {
                                          setFormatGuidesDraft((prev: MochiFormatGuideData) => {
                                            const next = { ...prev };
                                            if (formatGuidesCategory === "general") {
                                              next.formatGuide = {
                                                ...next.formatGuide,
                                                [item.key]: defaultContentValue,
                                              };
                                            } else if (formatGuidesCategory === "drawing_tags") {
                                              next.formatGuideDrawing = {
                                                ...next.formatGuideDrawing,
                                                tags: {
                                                  ...next.formatGuideDrawing.tags,
                                                  [item.key]: defaultContentValue,
                                                },
                                              };
                                            } else {
                                              next.formatGuideDrawing = {
                                                ...next.formatGuideDrawing,
                                                natural: {
                                                  ...next.formatGuideDrawing.natural,
                                                  [item.key]: defaultContentValue,
                                                },
                                              };
                                            }
                                            saveSettings({ formatGuidesJson: JSON.stringify(next) });
                                            return next;
                                          });
                                        }}
                                      >
                                        ↺ {localizeUi("ui.chat.mochiosview.formatGuideReset")}
                                      </button>
                                    )}
                                  </div>
                                )}

                                <svg
                                  className={`format-guide-chevron ${isExpanded ? "rotated" : ""}`}
                                  viewBox="0 0 24 24"
                                  width="18"
                                  height="18"
                                  onClick={() => setExpandedGuideKey(isExpanded ? null : item.key)}
                                >
                                  <path
                                    d="M6 9l6 6 6-6"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="format-guide-card-body">
                                <textarea
                                  className="format-guide-textarea"
                                  value={contentValue}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setFormatGuidesDraft((prev: MochiFormatGuideData) => {
                                      const next = { ...prev };
                                      if (formatGuidesCategory === "general") {
                                        next.formatGuide = { ...next.formatGuide, [item.key]: val };
                                      } else if (formatGuidesCategory === "drawing_tags") {
                                        next.formatGuideDrawing = {
                                          ...next.formatGuideDrawing,
                                          tags: { ...next.formatGuideDrawing.tags, [item.key]: val },
                                        };
                                      } else {
                                        next.formatGuideDrawing = {
                                          ...next.formatGuideDrawing,
                                          natural: { ...next.formatGuideDrawing.natural, [item.key]: val },
                                        };
                                      }
                                      saveSettings({ formatGuidesJson: JSON.stringify(next) });
                                      return next;
                                    });
                                  }}
                                  rows={14}
                                />
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {settingsActiveTab === "about" && (
                <div className="panel">
                  <div className="settings-section-title">{localizeUi("ui.characters.metadatatab.version")}</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      background: "var(--paper-dim)",
                      padding: "16px",
                      borderRadius: "18px",
                    }}
                  >
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: "16px",
                        background: "linear-gradient(160deg, var(--tile-a), var(--tile-b))",
                        display: "grid",
                        placeItems: "center",
                        color: "#fff",
                      }}
                    >
                      <MochiTabIcon size="2rem" />
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>
                        {localizeUi("ui.chat.homebrowserhub.mochiOs")}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
                        {localizeUi("ui.chat.mochiosview.version100")}
                      </div>
                    </div>
                  </div>
                  <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--muted)", marginTop: 4 }}>
                    {localizeUi("ui.chat.mochiosview.aPlayfulDesktopEnvironmentWithThemesLiveClockCustomizable")}
                  </p>
                </div>
              )}
            </div>
          </MochiSettingsSplit>
        </div>
      </div>}

      {/* ================= VOICE NOTE MODAL ================= */}
      <div
        className={`overlay ${voiceModalOpen ? "show" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            resetVoice();
            setVoiceModalOpen(false);
          }
        }}
      >
        <div className="modal">
          <div className="modal-head">
            <h3>{localizeUi("ui.chat.mochiosview.recordVoiceNote")}</h3>
            <button
              type="button"
              className="close"
              onClick={() => {
                resetVoice();
                setVoiceModalOpen(false);
              }}
            >
              ✕
            </button>
          </div>
          <div className="voice-rec">
            <button
              type="button"
              className={`micbig ${recording ? "recording" : ""}`}
              onClick={() => {
                if (!recording) beginVoiceRecording();
                else finishVoiceRecording();
              }}
            >
              <svg viewBox="0 0 24 24">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
              </svg>
            </button>
            <div className="rec-meta">
              <div className="rec-timer">
                {recording ? fmtDur(recElapsed) : hasRecordedAudio ? fmtDur(recDur) : "0:00"}
              </div>
              {recording && (
                <div className="rec-wave">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <i
                      key={i}
                      style={{
                        height: `${5 + Math.abs(Math.sin(recElapsed * 3 + i)) * 20}px`,
                      }}
                    />
                  ))}
                </div>
              )}
              <div className="rec-status">
                {recording
                  ? localizeUi("ui.chat.mochiosview.recording")
                  : hasRecordedAudio
                    ? localizeUi("ui.chat.mochiosview.recordingStopped")
                    : localizeUi("ui.chat.mochiosview.tapMicToRecord")}
              </div>
            </div>

            {hasRecordedAudio && (
              <div className="preview-row">
                <button type="button" className="rbtn play-btn" onClick={handleToggleVoicePlay}>
                  {previewPlaying ? (
                    <svg viewBox="0 0 16 16">
                      <rect x="3" y="2" width="4" height="12" rx="1" fill="currentColor" />
                      <rect x="9" y="2" width="4" height="12" rx="1" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 12 14">
                      <path d="M0 0l12 7-12 7z" />
                    </svg>
                  )}
                </button>
                <div className={`preview-wave ${previewPlaying ? "playing" : ""}`}>
                  {VOICE_WAVE_HEIGHTS.map((h, i) => (
                    <i key={i} style={{ height: `${h}px` }} />
                  ))}
                </div>
                <span className="preview-time">{fmtDur(recDur)}</span>
                <button
                  type="button"
                  className="del-btn"
                  title={localizeUi("home.widgets.delete")}
                  onClick={handleDeletePreview}
                >
                  <svg viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
            )}

            <div className="row" style={{ width: "100%" }}>
              <button type="button" className="btn" disabled={!hasRecordedAudio} onClick={handleSendVoiceNote}>
                {localizeUi("chat.input.send")}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  resetVoice();
                  setVoiceModalOpen(false);
                }}
              >
                {localizeUi("chat.delete.dialog.cancel")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================= TRANSFER MODAL ================= */}
      <div
        className={`overlay ${transferModalOpen ? "show" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setTransferModalOpen(false);
        }}
      >
        <div className="modal">
          <div className="modal-head">
            <h3>{localizeUi("ui.chat.mochiosview.transfer")}</h3>
            <button type="button" className="close" onClick={() => setTransferModalOpen(false)}>
              ✕
            </button>
          </div>
          <div className="panel">
            <span className="lbl">{localizeUi("ui.chat.mochiosview.transferAmount")}</span>
            <div className="mochi-transfer-amount-row">
              <select
                className="mochi-currency-select"
                aria-label={localizeUi("ui.chat.mochiosview.currency")}
                value={currency}
                onChange={(e) => {
                  const next = e.target.value as MochiCurrency;
                  setCurrency(next);
                  saveSettings({ currency: next });
                }}
              >
                {MOCHI_CURRENCY_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
              <input
                type="text"
                inputMode="decimal"
                placeholder={localizeUi("ui.chat.mochiosview.transferAmountPlaceholder")}
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
              />
            </div>
            <span className="lbl">{localizeUi("ui.chat.mochiosview.transferNote")}</span>
            <input
              type="text"
              placeholder={localizeUi("ui.chat.mochiosview.transferNotePlaceholder")}
              value={transferNote}
              onChange={(e) => setTransferNote(e.target.value)}
            />
            <div className="row" style={{ width: "100%" }}>
              <button
                type="button"
                className="btn"
                disabled={!Number(transferAmount.replace(/[^0-9.]/g, ""))}
                onClick={() => void handleSendTransfer()}
              >
                {localizeUi("chat.input.send")}
              </button>
              <button type="button" className="btn ghost" onClick={() => setTransferModalOpen(false)}>
                {localizeUi("chat.delete.dialog.cancel")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================= PERSONA PICKER MODAL ================= */}
      <div
        className={`overlay ${personaPickerOpen ? "show" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPersonaPickerOpen(false);
        }}
      >
        <div className="modal">
          <div className="modal-head">
            <h3>{localizeUi("ui.chat.mochiosview.selectPersona")}</h3>
            <button type="button" className="close" onClick={() => setPersonaPickerOpen(false)}>
              ✕
            </button>
          </div>

          <div className="m-search" style={{ margin: "0 0 14px", padding: "10px 14px" }}>
            <svg viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={localizeUi("ui.chat.mochiosview.searchPersonas")}
              value={personaSearchText}
              onChange={(e) => setPersonaSearchText(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="persona-pick-list">
            {allPersonas
              .filter((p) => !personaSearchText || `${p.name} ${p.title || ""}`.toLowerCase().includes(personaSearchText.toLowerCase()))
              .map((p) => {
                const isSelected = activeLinkedPersona?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`persona-pick-item ${isSelected ? "active" : ""}`}
                    onClick={() => {
                      setPersonaChoice({ chatId: activeChatId, id: p.id });
                      if (activeChatId) updateMochiPersona.mutate(p.id, {
                        onError: (error) => {
                          setPersonaChoice(null);
                          toast.error(error instanceof Error ? error.message : "Could not save persona");
                        },
                      });
                      setPersonaPickerOpen(false);
                    }}
                  >
                    <div className="persona-pick-ava">
                      {p.avatarPath ? (
                        <img src={p.avatarPath} alt="" style={getAvatarCropStyle(p.avatarCrop)} />
                      ) : (
                        <span>{p.name[0]?.toUpperCase()}</span>
                      )}
                    </div>
                    <div className="persona-pick-info">
                      <div className="persona-pick-name">{p.name}{p.title?.trim() ? ` (${p.title.trim()})` : ""}</div>
                      {p.description && <div className="persona-pick-desc">{p.description}</div>}
                    </div>
                    {isSelected && <span style={{ fontWeight: 900, color: "var(--acc)", fontSize: 16 }}>✓</span>}
                  </button>
                );
              })}
            {allPersonas.length === 0 && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)", fontWeight: 700 }}>
                {localizeUi("ui.chat.mochiosview.noPersonasFound")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================= AI GENERATED DATA MODAL ================= */}
      <div
        className={`overlay ${aiDataModalOpen ? "show" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget && !generatePhoneDataMutation.isPending) {
            handleCloseAiDataModal();
          }
        }}
      >
        <div className="modal mochi-ai-data-modal">
          <div className="modal-head">
            <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size="1.1rem" style={{ color: "var(--acc)" }} />
              <span>{localizeUi("ui.chat.mochiosview.aiGeneratedData")}</span>
            </h3>
            <button
              type="button"
              className="close"
              disabled={generatePhoneDataMutation.isPending}
              onClick={handleCloseAiDataModal}
            >
              ✕
            </button>
          </div>

          <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="lbl">{localizeUi("ui.chat.mochiosview.userRequestOptional")}</span>
              <textarea
                className="mochi-ai-data-textarea"
                rows={4}
                placeholder={localizeUi("ui.chat.mochiosview.userRequestPlaceholder")}
                value={aiDataUserRequest}
                onChange={(e) => setAiDataUserRequest(e.target.value)}
                disabled={generatePhoneDataMutation.isPending}
              />
            </div>

            <button
              type="button"
              className="btn"
              disabled={generatePhoneDataMutation.isPending}
              onClick={handleGeneratePhoneData}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              <Sparkles size="0.95rem" />
              <span>
                {generatePhoneDataMutation.isPending
                  ? localizeUi("ui.chat.mochiosview.generatingPhoneData")
                  : localizeUi("ui.chat.mochiosview.generatePhoneData")}
              </span>
            </button>

            {aiDataYamlDraft.trim().length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="lbl">{localizeUi("ui.chat.mochiosview.editAndConfirmYaml")}</span>
                  {yamlValidation.isValid ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        color: "var(--acc, #22c55e)",
                        fontWeight: 600,
                      }}
                    >
                      <CheckCircle2 size="0.9rem" />
                      {localizeUi("ui.chat.mochiosview.yamlValid")}
                    </span>
                  ) : (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        color: "#ef4444",
                        fontWeight: 600,
                      }}
                    >
                      <AlertCircle size="0.9rem" />
                      {localizeUi("ui.chat.mochiosview.invalidYaml", "Invalid YAML")}
                    </span>
                  )}
                </div>
                <textarea
                  className="mochi-ai-data-yaml-textarea"
                  rows={10}
                  value={aiDataYamlDraft}
                  onChange={(e) => {
                    const next = e.target.value;
                    setAiDataYamlDraft(next);
                    // Emptying the editor is the delete: there is nothing left to
                    // confirm, and a Save button disabled on empty text could never
                    // carry it out. Delete immediately and drop back to the plain
                    // generation popup, which is where the editor is no longer.
                    if (!next.trim() && aiDataYamlDraft.trim()) {
                      void handleErasePhoneDataYaml();
                    }
                  }}
                  disabled={savePhoneDataMutation.isPending}
                  spellCheck={false}
                  style={!yamlValidation.isValid ? { borderColor: "#ef4444" } : undefined}
                />
                {!yamlValidation.isValid && yamlValidation.error && (
                  <div
                    style={{
                      background: "rgba(239, 68, 68, 0.12)",
                      border: "1px solid rgba(239, 68, 68, 0.35)",
                      borderRadius: 10,
                      padding: "8px 12px",
                      color: "#ef4444",
                      fontSize: 12,
                      fontFamily: "monospace",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {localizeUi("ui.chat.mochiosview.yamlSyntaxError", { error: yamlValidation.error })}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={!aiDataYamlDraft.trim()}
                    onClick={handleDownloadYaml}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      background: "var(--card-bg, #2e3440)",
                      border: "1px solid var(--bubble-line, rgba(255, 255, 255, 0.15))",
                      color: "var(--text, #eceff4)",
                      fontWeight: 600,
                      cursor: !aiDataYamlDraft.trim() ? "not-allowed" : "pointer",
                      opacity: !aiDataYamlDraft.trim() ? 0.5 : 1,
                      flex: 1,
                    }}
                  >
                    <Download size="0.95rem" />
                    <span>{localizeUi("ui.chat.mochiosview.downloadYaml")}</span>
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={savePhoneDataMutation.isPending || !aiDataYamlDraft.trim() || !yamlValidation.isValid}
                    onClick={handleSavePhoneDataYaml}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      background: "var(--acc)",
                      color: "#fff",
                      fontWeight: 700,
                      opacity: !yamlValidation.isValid ? 0.5 : 1,
                      cursor: !yamlValidation.isValid ? "not-allowed" : "pointer",
                      flex: 1,
                    }}
                  >
                    <span>
                      {savePhoneDataMutation.isPending
                        ? localizeUi("chat.input.generating")
                        : localizeUi("ui.chat.mochiosview.saveAndApply")}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
