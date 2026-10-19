/**
 * Which chat the UI is looking at, and whether it is streaming.
 *
 * Mochi OS reads `activeChatId` to decide which chat to load and checks the
 * streaming flags to show a "typing" state. SillyTavern owns generation, so the
 * flags are driven from its streaming events by the extension entry point rather
 * than by a request this store starts.
 */
import { create } from 'zustand';

interface ChatState {
  activeChatId: string | null;
  isStreaming: boolean;
  streamingChatId: string | null;
  streamBuffer: string;
  setActiveChatId: (id: string | null) => void;
  setStreaming: (streaming: boolean, chatId?: string) => void;
  setStreamBuffer: (text: string, chatId?: string) => void;
  appendStreamBuffer: (text: string, chatId?: string) => void;
  clearStreamBuffer: (chatId?: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeChatId: null,
  isStreaming: false,
  streamingChatId: null,
  streamBuffer: '',

  setActiveChatId: (id) => {
    set((state) => (state.activeChatId === id ? state : { activeChatId: id, streamBuffer: '' }));
  },

  setStreaming: (streaming, chatId) => {
    set((state) => ({
      isStreaming: streaming,
      streamingChatId: streaming ? (chatId ?? state.streamingChatId) : null,
      streamBuffer: streaming ? state.streamBuffer : '',
    }));
  },

  setStreamBuffer: (text, chatId) => {
    set((state) => ({ streamBuffer: text, streamingChatId: chatId ?? state.streamingChatId }));
  },

  appendStreamBuffer: (text, chatId) => {
    set((state) => ({ streamBuffer: state.streamBuffer + text, streamingChatId: chatId ?? state.streamingChatId }));
  },

  clearStreamBuffer: () => set({ streamBuffer: '' }),
}));
