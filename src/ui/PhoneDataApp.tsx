/**
 * Profile app: the generated `phone_data` document.
 *
 * This is what the whole phone hangs off — contacts, groups and the user's own
 * screen name. It is generated once from the chat's character, then editable as
 * YAML so a model that invented the wrong roster can be corrected by hand.
 */
import { useCallback, useMemo, useState } from 'react';
import { useMochiOsSettings } from '../core/settings';
import { useStore, setState } from '../core/store';
import { deletePhoneData, setPhoneData } from '../core/phone-data';
import { AbortedError, generateMochiOutput } from '../core/generate';
import { buildMessages, guideText, resolveFormatGuides, resolvePreset } from '../core/prompt';
import { buildMochiDataGenerationGuideBlock } from '../mochi/utils';
import { cleanAndExtractRawYaml, extractAndParsePhoneDataYaml } from '../core/records';
import { getActiveCharacter, getPersonaText, getUserName, toast } from '../st/adapter';
import { translate } from '../compat/i18n';
import { contactsFrom, groupsFrom, userProfileFrom } from './model';

export function PhoneDataApp({ onBack }: { onBack: () => void }) {
  const { data: settings } = useMochiOsSettings();
  const phoneData = useStore((state) => state.phoneData);
  const phoneDataYaml = useStore((state) => state.phoneDataYaml);
  const busy = useStore((state) => state.busy);
  const [request, setRequest] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contacts = useMemo(() => contactsFrom(phoneData), [phoneData]);
  const groups = useMemo(() => groupsFrom(phoneData), [phoneData]);
  const profile = useMemo(() => userProfileFrom(phoneData), [phoneData]);

  const generate = useCallback(async () => {
    setError(null);
    setState({ busy: translate('ui.chat.mochiosview.generatingPhoneData'), notice: null });

    try {
      const character = getActiveCharacter();
      const guides = resolveFormatGuides(settings);
      const preset = resolvePreset(settings);

      // The data request is a generation like any other, but its guide block is
      // the data guide wrapped in "extend what is already here" rather than the
      // chat guides, which describe a turn's output instead of the document.
      const guide = buildMochiDataGenerationGuideBlock({
        existingYaml: phoneDataYaml || undefined,
        dataGuide: guideText(guides, 'data'),
      });

      const messages = buildMessages({
        preset,
        recordType: 'private',
        characterBlock: [
          character?.name ? `Name: ${character.name}` : '',
          character?.description ?? '',
          character?.personality ? `Personality: ${character.personality}` : '',
          character?.scenario ? `Scenario: ${character.scenario}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        personaBlock: getPersonaText(),
        worldInfoBlock: '',
        idCardsBlock: '',
        dialogueExamplesBlock: '',
        historyBlock: '',
        guide,
        userInput: request.trim() || guideText(guides, 'data'),
        continuationOnly: false,
      });

      const raw = await generateMochiOutput(messages);
      const cleaned = cleanAndExtractRawYaml(raw);

      // Parse before storing: an unparseable document would leave the phone with
      // no contacts and no way to tell it apart from a chat that was never set up.
      let parsed: unknown;
      try {
        parsed = extractAndParsePhoneDataYaml(cleaned, false);
      } catch (parseError: any) {
        throw new Error(`${translate('ui.chat.mochiosview.invalidYaml')} ${parseError?.message ?? ''}`);
      }
      if (!parsed || typeof parsed !== 'object') throw new Error(translate('ui.chat.mochiosview.invalidYaml'));

      setPhoneData(`<phone_data>\n${cleaned}\n</phone_data>`);
      setRequest('');
      setState({ busy: null });
      toast(translate('ui.chat.mochiosview.phoneDataGenerated'), 'success');
    } catch (caught) {
      setState({ busy: null });
      if (caught instanceof AbortedError) return;
      console.error('[Mochi OS] phone data generation failed', caught);
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
    }
  }, [phoneDataYaml, request, settings]);

  const yamlText = draft ?? phoneDataYaml;

  return (
    <>
      <div className="mtabs">
        <button type="button" className={`mtab${!editing ? ' active' : ''}`} onClick={() => setEditing(false)}>
          {translate('ui.chat.mochiosview.aiGeneratedData')}
        </button>
        <button type="button" className={`mtab${editing ? ' active' : ''}`} onClick={() => setEditing(true)}>
          {translate('ui.chat.mochiosview.editAndConfirmYaml')}
        </button>
      </div>

      <div className="mochi-os-extension-scroll">
        {editing ? (
          <>
            <div className="mochi-os-extension-field">
              <span>{translate('ui.chat.mochiosview.editAndConfirmYaml')}</span>
              <textarea value={yamlText} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
            </div>
            {error && <div className="mochi-os-extension-status is-error">{error}</div>}
            <div className="mochi-os-extension-actions">
              <button
                type="button"
                className="mochi-os-extension-btn is-primary"
                onClick={() => {
                  setPhoneData(draft ?? phoneDataYaml);
                  setDraft(null);
                  setEditing(false);
                  setError(null);
                }}
              >
                {translate('ui.chat.mochiosview.saveAndApply')}
              </button>
              <button
                type="button"
                className="mochi-os-extension-btn"
                onClick={() => {
                  setDraft(null);
                  setEditing(false);
                }}
              >
                {translate('ui.chat.mochiosview.cancel')}
              </button>
              <button
                type="button"
                className="mochi-os-extension-btn"
                onClick={() => {
                  void navigator.clipboard?.writeText(phoneDataYaml);
                  toast(translate('ui.chat.mochiosview.formatGuideCopied'), 'success');
                }}
              >
                {translate('ui.chat.mochiosview.exportYaml')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="profile-card">
              <div className="profile-bio-card">
                <strong>{profile.name || getUserName()}</strong>
                <div className="dim">{profile.bio || translate('ui.chat.mochiosview.bioPlaceholder')}</div>
                <div className="dim">{profile.email}</div>
              </div>
            </div>

            <div className="m-section-title">{translate('ui.chat.mochiosview.people')}</div>
            <div className="convo-list">
              {contacts.map((contact) => (
                <div key={contact.name} className="p-row">
                  <span className="p-ava">{Array.from(contact.name)[0]?.toUpperCase() ?? '?'}</span>
                  <span className="mrow">
                    <span className="s-name">{contact.name}</span>
                    <span className="dim">{contact.status || contact.bio}</span>
                  </span>
                </div>
              ))}
              {contacts.length === 0 && <div className="dim">{translate('ui.chat.mochiosview.noPersonasFound')}</div>}
            </div>

            {groups.length > 0 && (
              <>
                <div className="m-section-title">{translate('ui.chat.mochiosview.groupChat')}</div>
                <div className="convo-list">
                  {groups.map((group) => (
                    <div key={group.name} className="p-row">
                      <span className="p-ava">{Array.from(group.name)[0]?.toUpperCase() ?? '?'}</span>
                      <span className="mrow">
                        <span className="s-name">{group.name}</span>
                        <span className="dim">
                          {group.description ||
                            translate('ui.chat.mochiGroupChat.memberCount', { count: group.memberCount })}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="mochi-os-extension-field">
              <span>{translate('ui.chat.mochiosview.userRequestOptional')}</span>
              <input
                value={request}
                placeholder={translate('ui.chat.mochiosview.userRequestPlaceholder')}
                onChange={(event) => setRequest(event.target.value)}
              />
            </div>
            {error && <div className="mochi-os-extension-status is-error">{error}</div>}
            <div className="mochi-os-extension-actions">
              <button
                type="button"
                className="mochi-os-extension-btn is-primary"
                onClick={() => void generate()}
                disabled={Boolean(busy)}
              >
                {busy ? translate('ui.chat.mochiosview.generatingPhoneData') : translate('ui.chat.mochiosview.generateData')}
              </button>
              {phoneDataYaml && (
                <button
                  type="button"
                  className="mochi-os-extension-btn"
                  onClick={() => {
                    deletePhoneData();
                    toast(translate('ui.chat.mochiosview.phoneDataDeleted'), 'info');
                  }}
                >
                  {translate('ui.chat.mochiosview.del')}
                </button>
              )}
              <button type="button" className="mochi-os-extension-btn" onClick={onBack}>
                {translate('ui.chat.mochiosview.backToHome')}
              </button>
            </div>
            <div className="mochi-os-extension-note">
              {translate('mochi.st.storage')} — {translate('mochi.st.storageHint')}
            </div>
          </>
        )}
      </div>
    </>
  );
}