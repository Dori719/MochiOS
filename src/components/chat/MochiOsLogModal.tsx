import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Check, Smartphone, FileWarning } from "lucide-react";
import { Modal } from "../ui/Modal";
import { useMochiOSPhoneData } from "../../hooks/use-mochios-data";
import { useTranslation as useUiTranslation } from "react-i18next";

interface MochiOsLogModalProps {
  chatId: string;
  /** Snapshot stored on the log message; shown until (or instead of) the live read. */
  content: string;
  category?: string;
  contactName?: string;
  onClose: () => void;
}

export function MochiOsLogModal({ chatId, content, category, contactName, onClose }: MochiOsLogModalProps) {
  const { t: localizeUi } = useUiTranslation();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const resolvedCategory = category || "private_chats";

  // The log is a view of the YAML file, not a copy of it, so re-read it on every
  // open: edits and deletions made outside the app show up here immediately.
  const { data, isPending, isError } = useMochiOSPhoneData(chatId, {
    category: resolvedCategory,
    alwaysFresh: true,
  });

  // A private-chat log whose file no longer exists was removed server-side, so
  // refresh the message list to drop the now-empty bubble.
  const isMissing = !isPending && !isError && data?.logYaml == null && resolvedCategory === "private_chats";
  useEffect(() => {
    if (isMissing) {
      queryClient.invalidateQueries({ queryKey: ["chats", "messages", chatId] });
    }
  }, [isMissing, chatId, queryClient]);

  const displayContent = isMissing ? "" : (data?.logYaml ?? content);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const title = `${localizeUi("ui.chat.chatmessage.mochiOsLog")}${contactName ? ` - ${contactName}` : ""}${category ? ` (${category})` : ""}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width="max-w-2xl"
      panelClassName="max-h-[80vh] flex flex-col"
      chatFloatingPanel
    >
      <div className="flex flex-col flex-1 min-h-0 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Smartphone className="w-4 h-4 text-pink-400" />
            <span>{localizeUi("ui.chat.mochioslogmodal.mochiOsGeneratedContent")}</span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!displayContent}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--surface-layer-2)] hover:bg-[var(--surface-layer-3)] text-[var(--text-primary)] transition-colors disabled:opacity-40 disabled:hover:bg-[var(--surface-layer-2)]"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>{localizeUi("ui.panels.manualupdatecommand.copied")}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{localizeUi("ui.chat.mochioslogmodal.copyYaml")}</span>
              </>
            )}
          </button>
        </div>

        {isMissing ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <FileWarning className="w-6 h-6 text-amber-400" />
            <p className="text-sm text-[var(--text-primary)]">
              {localizeUi("ui.chat.mochioslogmodal.yamlMissingTitle")}
            </p>
            <p className="max-w-sm text-xs text-[var(--text-secondary)]">
              {localizeUi("ui.chat.mochioslogmodal.yamlMissingDescription")}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-4 rounded-lg bg-[var(--surface-layer-1)] font-mono text-xs text-[var(--text-secondary)] select-text whitespace-pre-wrap break-words max-h-[60vh]">
            {displayContent}
          </div>
        )}
      </div>
    </Modal>
  );
}
