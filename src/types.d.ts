/** Ambient declarations for SillyTavern's own modules and the CSS-as-text imports. */
declare module '/scripts/*' {
  export function getContext(): any;
  export function substituteParams(content: string, options?: Record<string, unknown>): string;
  export function generateRaw(options: Record<string, unknown>): Promise<string>;
  export function generateQuietPrompt(options?: Record<string, unknown>): Promise<string>;
  export function updateChatMetadata(values: Record<string, unknown>, reset?: boolean): void;
  export function saveMetadata(): Promise<void>;
  export function translate(text: string, key: string): string;
  export const ARGUMENT_TYPE: { STRING: string; NUMBER: string; BOOLEAN: string; LIST: string };
  export const SlashCommandParser: { addCommandObject(command: unknown): void };
  export const SlashCommand: { fromProps(props: Record<string, unknown>): unknown };
  export class SlashCommandArgument {
    constructor(description: string, type: string, required?: boolean, rest?: boolean, defaultValue?: string);
  }
  export class SlashCommandNamedArgument {
    constructor(name: string, description: string, type: string, required?: boolean, rest?: boolean, defaultValue?: string);
  }
}

declare module '*.css' {
  const content: string;
  export default content;
}