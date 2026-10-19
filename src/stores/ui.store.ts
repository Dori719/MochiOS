/**
 * User status and activity, and how many messages a page holds.
 *
 * The engine kept these in a large persisted UI store. Mochi OS reads a small
 * slice of it: the status the profile sheet shows, the activity line under the
 * name, the recent activities offered as suggestions, and the message page size.
 * Only that slice is reproduced here, backed by SillyTavern's extension settings
 * so the choices survive a reload.
 */
import { create } from 'zustand';
import { readChatSettings, writeChatSettings } from '../st/adapter';

export type UserStatus = 'active' | 'idle' | 'dnd' | 'invisible';

const USER_ACTIVITY_MAX_LENGTH = 80;
const RECENT_ACTIVITY_LIMIT = 6;

interface PersistedUI {
  userStatusManual?: UserStatus;
  userActivity?: string;
  recentUserActivities?: string[];
  messagesPerPage?: number;
}

function readPersisted(): PersistedUI {
  try {
    const stored = readChatSettings().ui as PersistedUI | undefined;
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    // SillyTavern is not reachable yet; defaults are used.
    return {};
  }
}

function persist(patch: PersistedUI): void {
  try {
    const current = readChatSettings().ui as PersistedUI | undefined;
    writeChatSettings({ ui: { ...(current ?? {}), ...patch } });
  } catch {
    // Nothing to persist outside the host.
  }
}

function normalizeActivity(activity: string): string {
  return activity.replace(/\s+/g, ' ').trim().slice(0, USER_ACTIVITY_MAX_LENGTH);
}

interface UIState {
  userStatusManual: UserStatus;
  userStatus: UserStatus;
  userActivity: string;
  recentUserActivities: string[];
  messagesPerPage: number;
  setMessagesPerPage: (value: number) => void;
  setUserStatus: (status: UserStatus) => void;
  setUserStatusManual: (status: UserStatus) => void;
  setUserActivity: (activity: string) => void;
  rememberUserActivity: (activity: string) => void;
}

const persisted = readPersisted();

export const useUIStore = create<UIState>((set, get) => ({
  userStatusManual: persisted.userStatusManual ?? 'active',
  userStatus: persisted.userStatusManual ?? 'active',
  userActivity: typeof persisted.userActivity === 'string' ? persisted.userActivity : '',
  recentUserActivities: Array.isArray(persisted.recentUserActivities) ? persisted.recentUserActivities : [],
  messagesPerPage: typeof persisted.messagesPerPage === 'number' ? persisted.messagesPerPage : 20,

  setMessagesPerPage: (value) => {
    set({ messagesPerPage: value });
    persist({ messagesPerPage: value });
  },

  setUserStatus: (status) => {
    // Presence is not derived from activity in the port, so the automatic and
    // manual paths write the same field.
    set({ userStatus: status });
    persist({ userStatusManual: status });
  },

  setUserStatusManual: (status) => {
    set({ userStatusManual: status, userStatus: status });
    persist({ userStatusManual: status });
  },

  setUserActivity: (activity) => {
    const next = normalizeActivity(activity);
    set({ userActivity: next });
    persist({ userActivity: next });
  },

  rememberUserActivity: (activity) => {
    const normalized = normalizeActivity(activity);
    if (!normalized) return;
    const current = get().recentUserActivities;
    const next = [
      normalized,
      ...current.filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
    ].slice(0, RECENT_ACTIVITY_LIMIT);
    set({ recentUserActivities: next });
    persist({ recentUserActivities: next });
  },
}));
