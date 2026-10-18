/**
 * A thread on the phone: the ported renderer, a composer, and the generation
 * loop.
 *
 * The loop is the engine's, moved into the browser:
 *   build messages from the preset  ->  one-shot completion  ->  post-process the
 *   turn  ->  append it to the thread's archive  ->  render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MochiPrivateChatThread } from '../mochi/PrivateChatWidget';
import { MochiGroupChatThread } from '../mochi/GroupChatWidget';
import { buildMochiContinuationPrompt, buildMochiGroupContinuationPrompt, removeLastMochiChatRecord } from '../mochi/utils';
import { useMochiOsSettings } from '../core/settings';
import { setState, useStore } from '../core/store';
import { appendTurn, findThread, replaceThreadArchive } from '../core/phone-data';
import { AbortedError, generateMochiOutput } from '../core/generate';
import {
  buildIdMacroCards,
  buildMessages,
  buildThreadHistory,
  guideText,
  resolveFormatGuides,
  resolvePreset,
} from '../core/prompt';
import { finalizeTurn, updateThreadMessageYaml } from '../core/records';
import { getActiveCharacter, getPersonaText, getWorldInfoText, toast } from '../st/adapter';
import { translate } from '../compat/i18n';
import { threadView } from './model';

export function ThreadApp({
  threadId,
  onBack,
  userName,
}: {
  threadId: string;
  onBack: () => void;
  userName: string;
}) {
  const { data: settings } = useMochiOsSettings();
  const revision = useStore((state) => state.revision);
  const busy = useStore((state) => state.busy);
  const [draft, setDraft] = useState('');
  const cancelledRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const thread = useMemo(() => findThread(threadId), [threadId, revision]);
  const view = useMemo(() => threadView(thread ?? null, userName), [thread, userName, revision]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      // A closed phone must not leave a generation running in the background.
      cancelledRef.current = true;
    };
  }, [threadId]);

  useEffect(() => {
    // The ported widget owns its own scroller, so the outer container is not the
    // thing that should jump: the newest message has to reach the bottom of the
    // element the renderer actually scrolls.
    const container = scrollerRef.current;
    if (!container) return;
    const inner = container.querySelector<HTMLElement>('.mochi-private-thread');
    if (inner) inner.scrollTop = inner.scrollHeight;
    else container.scrollTop = container.scrollHeight;
  }, [revision]);

  const isGroup = thread?.type === 'group';
  const recordType: 'private' | 'group' = isGroup ? 'group' : 'private';

  const buildContext = useCallback(
    (userInput: string) => {
      const character = getActiveCharacter();
      const guides = resolveFormatGuides(settings);
      const guide = guideText(guides, isGroup ? 'groupChat' : 'privateChat');
      const historyBlock = buildThreadHistory(
        thread?.yaml ?? '',
        recordType,
        isGroup ? thread?.target : undefined,
      );

      const preset = resolvePreset(settings);
      return buildMessages({
        preset,
        recordType,
        characterBlock: [
          character?.name ? `Name: ${character.name}` : '',
          character?.description ?? '',
          character?.personality ? `Personality: ${character.personality}` : '',
          character?.scenario ? `Scenario: ${character.scenario}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        personaBlock: getPersonaText(),
        worldInfoBlock: getWorldInfoText(),
        idCardsBlock: buildIdMacroCards({
          userName,
          characterName: character?.name ?? 'Character',
          bio: character?.description?.slice(0, 200),
        }),
        dialogueExamplesBlock: character?.mesExample ?? '',
        historyBlock,
        guide,
        userInput,
        continuationOnly: userInput.startsWith('[continue]'),
      });
    },
    [isGroup, recordType, settings, thread?.target, thread?.yaml, userName],
  );

  const runTurn = useCallback(
    async (params: { userInput: string; continuationOnly: boolean; userLines: string[] }) => {
      cancelledRef.current = false;
      setState({ busy: translate('mochi.st.generating'), notice: null });

      try {
        const raw = await generateMochiOutput(buildContext(params.userInput), () => cancelledRef.current);
        if (!raw.trim()) throw new Error(translate('mochi.st.phoneReplyFailed'));

        const turn = finalizeTurn({
          rawOutput: raw,
          target: thread?.target ?? 'Character',
          recordType,
          userLines: params.userLines,
          userName,
        });

        appendTurn(threadId, turn);
        setState({ busy: null });
      } catch (error) {
        setState({ busy: null });
        if (error instanceof AbortedError) return;
        console.error('[Mochi OS] thread generation failed', error);
        setState({ notice: { text: translate('mochi.st.phoneReplyFailed'), kind: 'error' } });
        toast(translate('mochi.st.phoneReplyFailed'), 'error');
      }
    },
    [buildContext, recordType, thread?.target, threadId, userName],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');

    // `[continue]` asks for another reply without saying anything, so it must not
    // be archived as something the user said.
    const continuationOnly = text.startsWith('[continue]');
    const userInput = continuationOnly
      ? isGroup
        ? buildMochiGroupContinuationPrompt(thread?.target ?? '')
        : buildMochiContinuationPrompt(thread?.target ?? '')
      : text;

    await runTurn({ userInput, continuationOnly, userLines: continuationOnly ? [] : [text] });
  }, [busy, draft, isGroup, runTurn, thread?.target]);

  const regenerate = useCallback(async () => {
    if (!thread?.yaml || busy) return;

    const lastUserLine = lastUserLineOf(thread.yaml);
    replaceThreadArchive(
      threadId,
      removeLastMochiChatRecord(thread.yaml, thread.target, undefined, { recordType }),
    );

    await runTurn({
      userInput: isGroup
        ? buildMochiGroupContinuationPrompt(thread.target)
        : buildMochiContinuationPrompt(thread.target),
      continuationOnly: true,
      userLines: lastUserLine ? [lastUserLine] : [],
    });
  }, [busy, isGroup, recordType, runTurn, thread, threadId]);

  const removeMessage = useCallback(
    (messageId: string) => {
      if (!thread) return;
      try {
        replaceThreadArchive(
          threadId,
          updateThreadMessageYaml(thread.yaml, messageId, undefined, { target: thread.target }),
        );
      } catch (error) {
        console.warn('[Mochi OS] could not delete message', error);
      }
    },
    [thread, threadId],
  );

  if (!thread) {
    return (
      <div className="mochi-os-extension-empty">
        <strong>{translate('ui.chat.mochiosview.empty')}</strong>
        <button type="button" className="mochi-os-extension-btn" onClick={onBack}>
          {translate('ui.chat.mochiosview.backToHome')}
        </button>
      </div>
    );
  }

  const deletable = (view?.chat.messages ?? []).filter((message) => !message.me && message.id);

  return (
    <>
      <div className="mochi-os-extension-thread-head">
        <button type="button" className="mochi-os-extension-back" onClick={onBack} aria-label={translate('ui.chat.mochiosview.backToHome')}>
          ←
        </button>
        <strong>{thread.target}</strong>
        <button
          type="button"
          className="mochi-os-extension-btn"
          onClick={regenerate}
          disabled={Boolean(busy) || !thread.yaml.trim()}
        >
          {translate('mochi.st.regenerate')}
        </button>
        <ArchiveButton threadId={threadId} />
      </div>

      <div className="mochi-os-extension-scroll" ref={scrollerRef}>
        {view ? (
          isGroup ? (
            <MochiGroupChatThread data={view} />
          ) : (
            <MochiPrivateChatThread data={view} defaultOpen />
          )
        ) : (
          <div className="mochi-os-extension-empty">
            <strong>{translate('ui.chat.mochiosview.noMessagesYet')}</strong>
            {translate('ui.chat.mochiosview.startTyping')}
          </div>
        )}

        {deletable.length > 0 && (
          <div className="mochi-os-extension-actions">
            {deletable.map((message) => (
              <button
                key={message.id}
                type="button"
                className="mochi-os-extension-btn"
                onClick={() => removeMessage(message.id!)}
                title={translate('ui.chat.mochiosview.messageActions')}
              >
                ✕ {(message.text ?? '').slice(0, 18)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mochi-os-extension-composer">
        <textarea
          value={draft}
          placeholder={translate('mochi.st.typeMessage')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="mochi-os-extension-btn is-primary"
          onClick={() => void send()}
          disabled={Boolean(busy)}
        >
          {busy ? translate('mochi.st.generating') : translate('mochi.st.send')}
        </button>
      </div>

      <div className="mochi-os-extension-status">
        {translate('mochi.st.archivedTurns')}: {countRecords(thread.yaml)}
      </div>
    </>
  );
}

function countRecords(yaml: string): number {
  return (yaml.match(/<(?:chat_history|privatechat_history|groupchat_history)(?:\s[^>]*)?>/gi) || []).length;
}

/** The user's own most recent archive line, so a regeneration still answers it. */
function lastUserLineOf(yaml: string): string | null {
  const items = [...yaml.matchAll(/- t:\s*([\w-]+)\s*\n\s*\{\{user\}\}:\s*true[^\n]*\n\s*c:\s*([^\n]+)/g)];
  const last = items[items.length - 1];
  return last ? last[2]!.trim() : null;
}

/** Open the raw archive, so a thread can be corrected by hand when the model slips. */
function ArchiveButton({ threadId }: { threadId: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const revision = useStore((state) => state.revision);
  const thread = useMemo(() => findThread(threadId), [threadId, revision]);

  if (!open) {
    return (
      <button
        type="button"
        className="mochi-os-extension-btn"
        onClick={() => setOpen(true)}
        title={translate('ui.chat.mochiosview.editAndConfirmYaml')}
      >
        {translate('ui.chat.mochiosview.editAndConfirmYamlShort')}
      </button>
    );
  }

  return (
    <div className="mochi-os-extension-scroll" style={{ position: 'absolute', inset: 0, background: 'var(--paper, #f2f8df)', zIndex: 5 }}>
      <div className="mochi-os-extension-field">
        <span>{translate('ui.chat.mochiosview.editAndConfirmYaml')}</span>
        <textarea value={draft ?? thread?.yaml ?? ''} onChange={(event) => setDraft(event.target.value)} />
      </div>
      <div className="mochi-os-extension-actions">
        <button
          type="button"
          className="mochi-os-extension-btn is-primary"
          onClick={() => {
            replaceThreadArchive(threadId, draft ?? '');
            setOpen(false);
            setDraft(null);
          }}
        >
          {translate('ui.chat.mochiosview.save')}
        </button>
        <button
          type="button"
          className="mochi-os-extension-btn"
          onClick={() => {
            setOpen(false);
            setDraft(null);
          }}
        >
          {translate('ui.chat.mochiosview.cancel')}
        </button>
        <button
          type="button"
          className="mochi-os-extension-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(thread?.yaml ?? '');
            toast(translate('ui.chat.mochiosview.formatGuideCopied'), 'success');
          }}
        >
          {translate('ui.chat.mochiosview.exportYaml')}
        </button>
      </div>
    </div>
  );
}