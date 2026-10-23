/**
 * Chats and roleplay messages, served from SillyTavern.
 *
 * The engine read chats from its database over HTTP. The port keeps the same
 * query keys and the same `useInfiniteQuery` page shape — Mochi OS flattens
 * `pages` itself — so the view needs no changes; only what answers the query
 * differs.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Chat, Message } from '../shared';
import { api } from '../lib/api-client';
import { useChatStore } from '../stores/chat.store';

export const chatKeys = {
  all: ['chats'] as const,
  list: () => ['chats', 'list'] as const,
  detail: (id: string | null | undefined) => ['chats', 'detail', id ?? ''] as const,
  messages: (id: string | null | undefined) => ['chats', 'messages', id ?? ''] as const,
  group: (groupId: string | null | undefined) => ['chats', 'group', groupId ?? ''] as const,
  trash: (id: string | null | undefined) => ['chats', 'trash', id ?? ''] as const,
};

function chatPath(id: string, suffix = ''): string {
  return `/chats/${encodeURIComponent(id)}${suffix}`;
}

/** The open chat, with the metadata Mochi OS reads for lorebook settings. */
export function useChat(id: string | null) {
  return useQuery<Chat>({
    queryKey: chatKeys.detail(id),
    queryFn: () => api.get<Chat>(chatPath(id as string)),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useUpdateMochiPersona(chatId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (personaId: string) => api.put<Chat>(chatPath(chatId as string, '/mochi-persona'), { personaId }),
    onSuccess: (chat) => {
      queryClient.setQueryData(chatKeys.detail(chatId), chat);
    },
  });
}

/**
 * A page of the chat's messages, oldest first within the page.
 *
 * The next page is requested with the id of the oldest message loaded so far,
 * which is stable across inserts and deletes.
 */
export function useChatMessages(chatId: string | null, pageSize: number, enabled: boolean) {
  return useInfiniteQuery<Message[], Error, InfiniteData<Message[]>, ReturnType<typeof chatKeys.messages>, string | null>({
    queryKey: chatKeys.messages(chatId),
    queryFn: ({ pageParam }) =>
      api.get<Message[]>(chatPath(chatId as string, '/messages'), {
        params: { limit: pageSize, before: pageParam },
      }),
    initialPageParam: null,
    getNextPageParam: (lastPage) =>
      pageSize > 0 && lastPage.length >= pageSize ? (lastPage[0]?.id ?? undefined) : undefined,
    enabled: Boolean(chatId) && enabled,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** Replace the content of one message, painting the edit before the round trip. */
export function useUpdateMessage(chatId: string | null) {
  const queryClient = useQueryClient();
  const key = chatKeys.messages(chatId);

  return useMutation({
    mutationFn: ({ messageId, content }: { messageId: string; content: string }) =>
      api.put<Message>(chatPath(chatId as string, `/messages/${encodeURIComponent(messageId)}`), { content }),

    onMutate: async ({ messageId, content }) => {
      if (!chatId) return undefined;
      const previous = queryClient.getQueryData<InfiniteData<Message[]>>(key);
      queryClient.setQueryData<InfiniteData<Message[]>>(key, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) =>
                page.map((message) => (message.id === messageId ? { ...message, content } : message)),
              ),
            }
          : old,
      );
      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },

    onSettled: () => {
      if (chatId) queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** Make one of a message's swipes the visible one. */
export function useSetActiveSwipe(chatId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, index }: { messageId: string; index: number }) =>
      api.put<Message>(chatPath(chatId as string, `/messages/${encodeURIComponent(messageId)}/active-swipe`), {
        index,
      }),
    onSettled: () => {
      if (chatId) queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
    },
  });
}

/**
 * Branch the chat at a message.
 *
 * SillyTavern performs the branch and switches to the new chat, so the store's
 * active chat has to follow it — Mochi OS reads the branch's id to keep showing
 * the conversation the user is now in.
 */
export function useBranchChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, upToMessageId }: { chatId: string; upToMessageId?: string }) =>
      api.post<Chat>(chatPath(chatId, '/branch'), { upToMessageId }),
    onSuccess: (newChat) => {
      if (newChat?.id) useChatStore.getState().setActiveChatId(newChat.id);
      queryClient.invalidateQueries({ queryKey: chatKeys.all });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.all });
    },
  });
}
