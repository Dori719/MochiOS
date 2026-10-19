/**
 * Slash commands for the Mochi OS composer.
 *
 * The engine's command set was bound to its own services — games, agents, media
 * generation, hidden messages. The port keeps the mechanism exactly as the view
 * uses it (a command is matched from the composer text, runs against a context,
 * and reports a line of feedback) and implements the commands that make sense
 * against SillyTavern: posting a line as someone, continuing, rolling dice,
 * setting the profile activity.
 *
 * The exported types mirror the engine's, because `MochiOsView` is unmodified
 * and passes its own context object to `execute`.
 */
import { useUIStore } from '../stores/ui.store';

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  /** Capability package that must be active before this command is advertised. */
  requiredCapabilityId?: string;
  /** Chat surfaces where this command is relevant. */
  modes?: Array<'conversation' | 'roleplay'>;
  /** If true, the command is handled locally and never reaches the model. */
  local?: boolean;
  execute: (args: string, ctx: SlashCommandContext) => Promise<SlashCommandResult>;
}

export interface SlashCommandContext {
  chatId: string;
  mode?: 'conversation' | 'roleplay';
  generate: (params: {
    chatId: string;
    connectionId: string | null;
    userMessage?: string;
    continueMessageId?: string;
    impersonate?: boolean;
    [key: string]: unknown;
  }) => Promise<boolean | void>;
  createMessage: (data: {
    role: string;
    content: string;
    characterId?: string | null;
    extra?: Record<string, unknown>;
    [key: string]: unknown;
  }) => void | Promise<void>;
  invalidate: () => void;
  characterNames: string[];
  characters?: Array<{ id: string; name: string }>;
  latestAssistantMessageId?: string | null;
  lastMessageRole?: string | null;
  availableCapabilityIds?: ReadonlySet<string>;
}

export interface SlashCommandResult {
  /** If true, the input was handled and must not be sent as chat text. */
  handled: boolean;
  /** Optional feedback to show (ephemeral, not persisted). */
  feedback?: string;
}

export interface SlashCommandAvailability {
  mode?: 'conversation' | 'roleplay';
  availableCapabilityIds?: ReadonlySet<string>;
}

function isAvailable(command: SlashCommand, availability: SlashCommandAvailability): boolean {
  if (command.modes && command.modes.length > 0 && availability.mode && !command.modes.includes(availability.mode)) {
    return false;
  }
  if (
    command.requiredCapabilityId &&
    availability.availableCapabilityIds &&
    !availability.availableCapabilityIds.has(command.requiredCapabilityId)
  ) {
    return false;
  }
  return true;
}

function resolveCharacterId(name: string, context: SlashCommandContext): string | undefined {
  if (!name) return undefined;
  const lowered = name.toLowerCase();
  const match = context.characters?.find((character) => character.name.toLowerCase() === lowered);
  return match?.id;
}

const COMMANDS: SlashCommand[] = [
  {
    name: 'help',
    description: 'List the commands available here.',
    usage: '/help',
    local: true,
    execute: async () => ({
      handled: true,
      feedback: ['Commands:', ...COMMANDS.map((command) => `${command.usage} — ${command.description}`)].join('\n'),
    }),
  },
  {
    name: 'roll',
    description: 'Roll dice, e.g. 2d6.',
    usage: '/roll <NdM>',
    local: true,
    execute: async (args) => {
      const notation = (args.trim().split(/\s+/)[0] || '1d20').toLowerCase();
      const match = /^(\d*)d(\d+)$/.exec(notation);
      if (!match) return { handled: true, feedback: `Tip: use NdM, for example 2d6. Got "${notation}".` };
      const count = Math.min(Number(match[1] || 1), 20);
      const sides = Math.max(2, Math.min(Number(match[2]), 1000));
      const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
      const total = rolls.reduce((sum, value) => sum + value, 0);
      return { handled: true, feedback: `${notation}: ${rolls.join(' + ')} = ${total}` };
    },
  },
  {
    name: 'random',
    description: 'Pick a random number.',
    usage: '/random [min] [max]',
    local: true,
    execute: async (args) => {
      const [rawMin, rawMax] = args.trim().split(/\s+/);
      const min = Number(rawMin ?? 1);
      const max = Number(rawMax ?? 100);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
        return { handled: true, feedback: 'Tip: /random <min> <max>, with max not below min.' };
      }
      return { handled: true, feedback: String(min + Math.floor(Math.random() * (max - min + 1))) };
    },
  },
  {
    name: 'sys',
    description: 'Post a system line into the chat.',
    usage: '/sys <text>',
    local: true,
    execute: async (args, ctx) => {
      const text = args.trim();
      if (!text) return { handled: true, feedback: 'Tip: /sys <text>.' };
      await ctx.createMessage({ role: 'system', content: text });
      ctx.invalidate();
      return { handled: true, feedback: 'System line posted.' };
    },
  },
  {
    name: 'as',
    description: 'Post a reply as a character.',
    usage: '/as <name> <text>',
    local: true,
    execute: async (args, ctx) => {
      const spaceIndex = args.trim().indexOf(' ');
      if (spaceIndex < 0) return { handled: true, feedback: 'Tip: /as <name> <text>.' };
      const name = args.trim().slice(0, spaceIndex);
      const text = args.trim().slice(spaceIndex + 1).trim();
      if (!text) return { handled: true, feedback: 'Tip: /as <name> <text>.' };
      await ctx.createMessage({ role: 'assistant', characterId: resolveCharacterId(name, ctx), content: text, name });
      ctx.invalidate();
      return { handled: true, feedback: `Posted as ${name}.` };
    },
  },
  {
    name: 'continue',
    description: 'Ask the model to keep the scene going.',
    usage: '/continue',
    execute: async (_args, ctx) => {
      await ctx.generate({
        chatId: ctx.chatId,
        connectionId: null,
        ...(ctx.latestAssistantMessageId ? { continueMessageId: ctx.latestAssistantMessageId } : {}),
      });
      return { handled: true, feedback: 'Continuing…' };
    },
  },
  {
    name: 'status',
    description: 'Set the activity line on your profile.',
    usage: '/status <text>',
    local: true,
    execute: async (args) => {
      const text = args.trim();
      useUIStore.getState().setUserActivity(text);
      if (text) useUIStore.getState().rememberUserActivity(text);
      return { handled: true, feedback: text ? `Activity set to "${text}".` : 'Activity cleared.' };
    },
  },
  {
    name: 'macros',
    description: 'Show the placeholders the format guides use.',
    usage: '/macros',
    local: true,
    execute: async () => ({
      handled: true,
      feedback: [
        'Format guide placeholders:',
        '{{user}} — your screen name.',
        '{{char}} — the character you are talking to.',
        '{{Time}} / {{Date}} — the phone clock.',
        '{{Weather}} — the weather line.',
      ].join('\n'),
    }),
  },
];

function getAvailableSlashCommands(availability: SlashCommandAvailability = {}): SlashCommand[] {
  return COMMANDS.filter((command) => isAvailable(command, availability));
}

/** Usage line for a command, for help text and autocomplete. */
export function getSlashCommandUsage(command: SlashCommand): string {
  return command.usage;
}

/** Find a matching command for the given input. */
export function matchSlashCommand(
  input: string,
  availability: SlashCommandAvailability = {},
): { command: SlashCommand; args: string } | null {
  if (!input.startsWith('/')) return null;
  const spaceIndex = input.indexOf(' ');
  const name = (spaceIndex === -1 ? input.slice(1) : input.slice(1, spaceIndex)).toLowerCase();
  const args = spaceIndex === -1 ? '' : input.slice(spaceIndex + 1);

  for (const command of getAvailableSlashCommands(availability)) {
    if (command.name === name || command.aliases?.includes(name)) return { command, args };
  }
  return null;
}

/** Keep a Quick Reply's post-only action from saving a command as plain chat text. */
export function shouldExecuteQuickPostAsCommand(input: string, availability: SlashCommandAvailability = {}): boolean {
  return matchSlashCommand(input.trim(), availability) !== null;
}

/** Commands matching a partial prefix, for the composer's autocomplete. */
export function getSlashCompletions(partial: string, availability: SlashCommandAvailability = {}): SlashCommand[] {
  if (!partial.startsWith('/')) return [];
  const rawPrefix = partial.slice(1);
  if (rawPrefix.includes(' ')) return [];
  const prefix = rawPrefix.trim().toLowerCase();
  const available = getAvailableSlashCommands(availability);
  if (!prefix) return available;
  return available.filter(
    (command) => command.name.startsWith(prefix) || command.aliases?.some((alias) => alias.startsWith(prefix)),
  );
}

export { COMMANDS as SLASH_COMMANDS };
