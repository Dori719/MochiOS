import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api-client";
import type { MochiMessage } from "../components/chat/mochi-os/mochi-os.types";
import type {
  MochiOsPhoneDataResponse,
  MochiOsCharacterData,
  MochiOsGroupData,
  MochiOsUserData,
  MochiOsPhoneData,
} from "@marinara-engine/shared";

const MAX_MOCHI_RATE_LIMIT_RETRIES = 6;
const MOCHI_RATE_LIMIT_BACKOFF_BASE_MS = 2_000;
const MOCHI_RATE_LIMIT_BACKOFF_CAP_MS = 60_000;

function isMochiRateLimitError(error: unknown): boolean {
  if (error instanceof ApiError && (error.status === 429 || error.status === 529)) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  return /\b(rate[ -]?limit|too many requests|quota|429|529)\b/.test(message);
}

export type { MochiOsPhoneDataResponse, MochiOsCharacterData, MochiOsGroupData, MochiOsUserData, MochiOsPhoneData };

export function useMochiOSPhoneData(
  chatId: string | null | undefined,
  options?: { characterName?: string; category?: string; alwaysFresh?: boolean },
) {
  return useQuery<MochiOsPhoneDataResponse>({
    queryKey: ["mochios-data", chatId, options?.characterName, options?.category],
    queryFn: async () => {
      if (!chatId) return { phoneData: null, rawYaml: null };
      const params = new URLSearchParams();
      if (options?.characterName) params.set("characterName", options.characterName);
      if (options?.category) params.set("category", options.category);
      const queryStr = params.toString() ? `?${params.toString()}` : "";
      return api.get<MochiOsPhoneDataResponse>(`/mochios-data/${encodeURIComponent(chatId)}${queryStr}`);
    },
    enabled: Boolean(chatId),
    // `alwaysFresh` is for the Mochi OS log viewer, which is a view of the file on
    // disk: it must re-read every time it opens so edits and deletions made outside
    // the app are reflected instead of served from cache.
    staleTime: options?.alwaysFresh ? 0 : 60 * 1000,
    refetchOnMount: options?.alwaysFresh ? "always" : true,
  });
}

export function useGenerateMochiOSPhoneData() {
  const queryClient = useQueryClient();
  return useMutation<
    { rawOutput: string },
    Error,
    {
      chatId: string;
      messages: Array<{ role: "system" | "user" | "assistant"; content: string; name?: string }>;
      connectionId?: string;
      userPrompt?: string;
      category?: "data_generation" | "private_chats" | "group_chats" | string;
      characterName?: string;
      /** The thread being written: a contact name for a private chat, a group name for a group chat. */
      contactName?: string;
      /** The user's own screen name, written as the `sender` on a group record's user items. */
      userName?: string;
      /**
       * True when the user asked for another reply without typing anything. The
       * request text is an instruction, not something they said, so the server
       * must not archive it as a `{{user}}: true` message.
       */
      continuationOnly?: boolean;
      userMessages?: MochiMessage[];
      signal?: AbortSignal;
    }
  >({
    mutationFn: async ({
      chatId,
      messages,
      connectionId,
      userPrompt,
      category,
      characterName,
      contactName,
      userName,
      continuationOnly,
      userMessages,
      signal,
    }) => {
      const payload = {
        messages,
        connectionId,
        userPrompt,
        category,
        characterName,
        contactName,
        userName,
        continuationOnly,
        userMessages,
      };
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await api.post<{ rawOutput: string }>(`/mochios-data/${encodeURIComponent(chatId)}/generate`, payload, {
            signal,
          });
        } catch (error) {
          if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
            throw error;
          }
          if (!isMochiRateLimitError(error) || attempt >= MAX_MOCHI_RATE_LIMIT_RETRIES) {
            throw error;
          }
          const delayMs = Math.min(MOCHI_RATE_LIMIT_BACKOFF_BASE_MS * 2 ** attempt, MOCHI_RATE_LIMIT_BACKOFF_CAP_MS);
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }
    },
    onSuccess: async (_data, variables) => {
      if (isMochiThreadCategory(variables.category)) {
        // Generation writes the complete updated archive on the server. Refresh
        // the canonical log query so the next prompt does not reuse the previous
        // turn's cached YAML.
        await queryClient.refetchQueries({
          queryKey: ["mochios-data", variables.chatId, undefined, variables.category],
        });
      }
    },
  });
}

/**
 * True for the Mochi OS categories whose archive is roleplay message history
 * rather than a YAML file. Private and group threads both qualify, and both need
 * the same post-generation refresh.
 */
function isMochiThreadCategory(category?: string): boolean {
  return category === "private_chats" || category === "group_chats";
}

export function useSaveMochiOSPhoneData() {
  const queryClient = useQueryClient();

  return useMutation<
    MochiOsPhoneDataResponse,
    Error,
    {
      chatId: string;
      /** Full YAML replacement. Omitted when a targeted per-message update is used. */
      rawYaml?: string;
      characterName?: string;
      category?: string;
      /** Target a single message item by its `id: msg_xxx` instead of rewriting the whole file. */
      messageId?: string;
      /** Zero-based occurrence for archives whose message ids repeat between turns. */
      messageOccurrence?: number;
      messageContent?: string;
      deleteMessage?: boolean;
    }
  >({
    mutationFn: async ({
      chatId,
      rawYaml,
      characterName,
      category,
      messageId,
      messageOccurrence,
      messageContent,
      deleteMessage,
    }) => {
      return api.put<MochiOsPhoneDataResponse>(`/mochios-data/${encodeURIComponent(chatId)}`, {
        rawYaml,
        characterName,
        category,
        messageId,
        messageOccurrence,
        messageContent,
        deleteMessage,
      });
    },
    onMutate: async (variables) => {
      // Stop a GET that began before this write from resolving afterward with
      // stale YAML and rehydrating a message the user just deleted.
      await queryClient.cancelQueries({ queryKey: ["mochios-data", variables.chatId] });
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(["mochios-data", variables.chatId, variables.characterName, variables.category], data);
      // The Mochi OS view reads this key: it passes no characterName, so the
      // write above lands on a cache entry nothing observes. Without this the
      // view keeps the pre-save YAML until a refetch returns, which is the window
      // where a just-deleted message can be rehydrated.
      queryClient.setQueryData(["mochios-data", variables.chatId, undefined, variables.category], data);
      // …and it passes no category either, so its key is `[chatId, undefined,
      // undefined]`. Neither write above lands there, which left the view showing
      // the contacts and groups the save had just replaced until the user left
      // Mochi OS and came back, remounting the query. Invalidate by chat so every
      // key shape for this chat refetches, including the view's.
      queryClient.invalidateQueries({ queryKey: ["mochios-data", variables.chatId] });
      if (isMochiThreadCategory(variables.category)) {
        queryClient.invalidateQueries({ queryKey: ["chats", "messages", variables.chatId] });
      }
    },
  });
}

export function useDeleteMochiOSPhoneData() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, { chatId: string; characterName?: string; category?: string }>({
    mutationFn: async ({ chatId, characterName, category }) => {
      const params = new URLSearchParams();
      if (characterName) params.set("characterName", characterName);
      if (category) params.set("category", category);
      const queryStr = params.toString() ? `?${params.toString()}` : "";
      return api.delete<{ success: boolean }>(`/mochios-data/${encodeURIComponent(chatId)}${queryStr}`);
    },
    onSuccess: (_, variables) => {
      queryClient.setQueryData(["mochios-data", variables.chatId, variables.characterName, variables.category], {
        phoneData: null,
        rawYaml: null,
        logYaml: null,
      });
      queryClient.setQueryData(["mochios-data", variables.chatId], {
        phoneData: null,
        rawYaml: null,
        logYaml: null,
      });
      // The server drops the Mochi OS thread log along with the file, so the
      // bubble in the roleplay chat has to go too.
      if (isMochiThreadCategory(variables.category)) {
        queryClient.invalidateQueries({ queryKey: ["chats", "messages", variables.chatId] });
      }
      queryClient.invalidateQueries({ queryKey: ["mochios-data"] });
    },
  });
}
