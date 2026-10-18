/**
 * The Messages app: contacts and groups, each opening its own thread.
 *
 * The row markup follows the ported stylesheet's conversation list (`.crow` /
 * `.ava` / `.info` / `.meta`) so the rows look like the engine's rather than
 * like a fresh set of styles.
 */
import { useMemo, useState } from 'react';
import { useStore, type MochiThreadRecord } from '../core/store';
import { openThread } from '../core/phone-data';
import { getMochiCharacterColor } from '../mochi/character-color';
import { translate } from '../compat/i18n';
import { contactsFrom, groupsFrom, threadPreview } from './model';

type Tab = 'contacts' | 'groups';

export function MessagesApp({
  onBack,
  onOpenThread,
  userName,
}: {
  onBack: () => void;
  onOpenThread: () => void;
  userName: string;
}) {
  const phoneData = useStore((state) => state.phoneData);
  const threads = useStore((state) => state.threads);
  const [tab, setTab] = useState<Tab>('contacts');
  const [query, setQuery] = useState('');

  const contacts = useMemo(() => contactsFrom(phoneData), [phoneData]);
  const groups = useMemo(() => groupsFrom(phoneData), [phoneData]);

  const threadFor = (target: string, type: 'private' | 'group'): MochiThreadRecord | undefined =>
    threads.find((thread) => thread.target === target && thread.type === type);

  const needle = query.trim().toLowerCase();
  const isGroupTab = tab === 'groups';
  const names = (isGroupTab ? groups : contacts)
    .map((entry) => entry.name)
    .filter((name) => !needle || name.toLowerCase().includes(needle));

  return (
    <>
      <div className="mtabs">
        <button
          type="button"
          className={`mtab${isGroupTab ? '' : ' active'}`}
          onClick={() => setTab('contacts')}
        >
          {translate('ui.chat.mochiosview.people')}
        </button>
        <button
          type="button"
          className={`mtab${isGroupTab ? ' active' : ''}`}
          onClick={() => setTab('groups')}
        >
          {translate('ui.chat.mochiosview.groupChat')}
        </button>
      </div>

      <div className="m-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <input
          type="search"
          value={query}
          placeholder={translate(
            isGroupTab ? 'ui.chat.mochiosview.searchPeople' : 'ui.chat.mochiosview.searchContacts',
          )}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="convo-list">
        {names.length === 0 && (
          <div className="mochi-os-extension-empty">
            <strong>{phoneData ? translate('ui.chat.mochiosview.empty') : translate('mochi.st.noData')}</strong>
            {phoneData ? translate('ui.chat.mochiosview.noDataHint') : translate('mochi.st.generateData')}
          </div>
        )}

        {isGroupTab
          ? names.map((name) => {
              const group = groups.find((entry) => entry.name === name)!;
              const thread = threadFor(name, 'group');
              const preview = thread ? threadPreview(thread, userName) : { text: '' };
              return (
                <button
                  key={name}
                  type="button"
                  className="crow"
                  onClick={() => {
                    openThread(name, 'group');
                    onOpenThread();
                  }}
                >
                  <span className="ava" style={{ '--c': getMochiCharacterColor(name) } as React.CSSProperties}>
                    {Array.from(name)[0]?.toUpperCase() ?? '?'}
                  </span>
                  <span className="info">
                    <b>{name}</b>
                    <span>
                      {preview.text ||
                        group.description ||
                        translate('ui.chat.mochiGroupChat.memberCount', { count: group.memberCount })}
                    </span>
                  </span>
                  <span className="meta">
                    {preview.time && <time>{preview.time}</time>}
                  </span>
                </button>
              );
            })
          : names.map((name) => {
              const contact = contacts.find((entry) => entry.name === name)!;
              const thread = threadFor(name, 'private');
              const preview = thread ? threadPreview(thread, userName) : { text: '' };
              return (
                <button
                  key={name}
                  type="button"
                  className="crow"
                  onClick={() => {
                    openThread(name, 'private');
                    onOpenThread();
                  }}
                >
                  <span className="ava" style={{ '--c': getMochiCharacterColor(name) } as React.CSSProperties}>
                    {Array.from(name)[0]?.toUpperCase() ?? '?'}
                  </span>
                  <span className="info">
                    <b>{name}</b>
                    <span>
                      {preview.text || contact.status || contact.bio || translate('ui.chat.mochiosview.noMessagesYet')}
                    </span>
                  </span>
                  <span className="meta">
                    {preview.time ? <time>{preview.time}</time> : <span className="udot" />}
                  </span>
                </button>
              );
            })}
      </div>

      <div className="mochi-os-extension-actions">
        <button type="button" className="mochi-os-extension-btn" onClick={onBack}>
          {translate('ui.chat.mochiosview.backToHome')}
        </button>
      </div>
    </>
  );
}