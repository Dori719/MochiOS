/** Runs only in preview-st.mjs's isolated origin. No live host/provider access. */
const RELOAD_KEY = 'mochi-preview-sticker-reload-check';
const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
const q = (selector) => document.querySelector(selector);
const all = (selector) => Array.from(document.querySelectorAll(selector));
const rows = () => all('#chatView .mrow[data-msg-id]');
const incoming = () => rows().filter((row) => !row.classList.contains('out'));
const outgoing = () => rows().filter((row) => row.classList.contains('out'));

async function until(condition, description) {
  const deadline = performance.now() + 6000;
  while (performance.now() < deadline) {
    if (condition()) return;
    await settle(50);
  }
  throw new Error(`Timed out: ${description}`);
}

function pointer(element, type, { x = 20, y = 20, pointerType = 'mouse', pointerId = 71 } = {}) {
  element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType, isPrimary: true, button: 0, clientX: x, clientY: y }));
}

function press(element) {
  if (!element) throw new Error('A required UI control is missing');
  const bounds = element.getBoundingClientRect();
  const position = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  pointer(element, 'pointerdown', position);
  pointer(element, 'pointerup', position);
  element.click();
}

function value(element, text) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(element, name, phase = 'keydown') {
  element.dispatchEvent(new KeyboardEvent(phase, { key: name, bubbles: true, cancelable: true }));
}

function tab(name) {
  return all('.mochi-media-picker-tabs button').find((button) => button.textContent === name);
}

async function openPicker(name = 'Emoji') {
  if (!q('[data-conversation-media-picker]')) {
    if (!q('#chatView .c-bar.open')) press(q('#plusBtn'));
    await settle();
    press(q('#emojiBtn'));
    await until(() => q('[data-conversation-media-picker]'), 'media picker');
  }
  press(tab(name));
  await settle();
}

async function openThread(name) {
  if (q('.app-window.open.chat')) {
    press(q('#chatView .c-head > button:first-child'));
    await settle();
  }
  if (!q('.app-window.open')) {
    press(q('button[aria-label="Messages"]'));
    await settle();
  }
  press(q('#listView .mtabs button:first-child'));
  await until(() => all('#listView .crow').some((row) => row.querySelector('.info b')?.textContent === name), name);
  press(all('#listView .crow').find((row) => row.querySelector('.info b')?.textContent === name));
  await settle(300);
}

function sendText(text) {
  const input = q('#chatView .c-bar > input');
  value(input, text);
  key(input, 'Enter');
}

async function importFiles(files) {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  const input = q('input[aria-label="Import sticker images"]');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function stickerFile() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 48;
  const context = canvas.getContext('2d');
  context.fillStyle = '#6fa2cc'; context.fillRect(0, 0, 48, 48);
  context.fillStyle = '#ffffff'; context.beginPath(); context.arc(24, 24, 15, 0, Math.PI * 2); context.fill();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new File([blob], `Mochi Browser ${Date.now()}.png`, { type: 'image/png' });
}

async function savedStickers() {
  if (typeof navigator.storage?.getDirectory === 'function') {
    const root = await navigator.storage.getDirectory();
    const mochi = await root.getDirectoryHandle('mochi-os');
    const folder = await mochi.getDirectoryHandle('stickers');
    const manifest = JSON.parse(await (await (await folder.getFileHandle('library.json')).getFile()).text());
    return { list: manifest, async image(entry) { return (await folder.getFileHandle(entry.fileName)).getFile(); } };
  }
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('mochi-os-stickers');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const list = await new Promise((resolve, reject) => {
    const transaction = database.transaction('stickers', 'readonly');
    const request = transaction.objectStore('stickers').getAll();
    transaction.oncomplete = () => resolve(request.result); transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  return { list, image: async (entry) => entry.blob };
}

function groupReply(stickerName) {
  return `<groupchat_history target="Preview Group">\nname: Preview Group\nmessages:\n  - id: msg_001\n    t: text\n    c: Model echo must not duplicate input\n    "{{user}}": true\n    sender: {name: Preview User}\n  - id: msg_002\n    t: text\n    c: Offline group reply\n    sender: {name: Preview Character}\n  - id: msg_003\n    t: sticker\n    c: ${stickerName}\n    sender: {name: Other Character}\n</groupchat_history>\n<environment>\ndate: Today\ntime: "12:03"\nweather: Rainy\n</environment>`;
}

export function installPreviewRegressions({ getContext, preview, openMochiOs, closeMochiOs, isMochiOsOpen, refreshMochiWidgets, viewport, setKeyboard }) {
  const within = (bounds) => bounds.left >= -1 && bounds.top >= -1 && bounds.right <= viewport.width + 1 && bounds.bottom <= viewport.height + 1;
  const report = q('#preview-status');
  const button = q('#test-features');

  q('#test-updates').onclick = async () => {
    const checks = [];
    const assert = (ok, description) => { if (!ok) throw new Error(description); checks.push(description); };
    const control = q('#test-updates');
    control.disabled = true;
    try {
      closeMochiOs(); await settle(); preview.reset(); setKeyboard(false);
      await getContext().printMessages(); refreshMochiWidgets(); openMochiOs(); await settle(450);
      const screen = q('#mochi-os-host .screen');
      const screenBounds = screen.getBoundingClientRect();
      const mascots = all('#mochi-os-host .mascot');
      assert(mascots.length === 2 && mascots.every((mascot) => {
        const style = getComputedStyle(mascot); const bounds = mascot.getBoundingClientRect();
        return style.display !== 'none' && style.pointerEvents === 'none' && Number(style.zIndex) < Number(getComputedStyle(q('#mochi-os-host .apps')).zIndex)
          && bounds.right > screenBounds.left && bounds.left < screenBounds.right && bounds.bottom > screenBounds.top && bounds.top < screenBounds.bottom;
      }), 'Both floating mascots are visible, cropped inside the phone, and behind clickable apps');
      assert(screen.scrollWidth <= screen.clientWidth + 1, 'Cropped wallpaper does not add horizontal scrolling');
      await openThread('Preview Contact');
      assert(incoming().length === 1 && q('#chatView .c-head').textContent.includes('Preview Contact'), 'The phone reads target-only private history with a phone_data display alias');
      const inline = q('#chat .mes[mesid="0"] .mochi-private-widget');
      assert(inline?.textContent.includes('Preview Contact'), 'The inline widget uses the same private contact alias');
      press(q('#chatView .c-head > button:first-child')); await settle();
      press(q('#listView .mtabs button:last-child')); await settle();
      assert(q('.profile-card h3').textContent === 'Preview User', 'First entry selects the roleplay persona instead of the first/default persona');
      assert(q('.profile-card .p-ava').getBoundingClientRect().width === 64 && q('.profile-bio-textarea').rows === 4 && parseFloat(getComputedStyle(q('.profile-bio-textarea')).minHeight) <= 96, 'Profile avatar and bio are scaled down without shrinking editable text');
      press(q('.edit-profile-btn')); await settle();
      const chosen = all('.persona-pick-item').find((item) => item.classList.contains('active'));
      assert(chosen?.querySelector('.persona-pick-name').textContent === 'Preview User (Roleplay persona)', 'Persona picker displays Name (Title) and marks the roleplay choice');
      const firstPersona = all('.persona-pick-item').find((item) => item.querySelector('.persona-pick-name').textContent.startsWith('First Persona'));
      press(firstPersona); await settle(250);
      assert(getContext().chatMetadata.mochios.linkedPersonaId === 'first-persona.png', 'A manual persona choice is saved with this roleplay');
      closeMochiOs(); await settle(); openMochiOs(); await settle(350);
      press(q('button[aria-label="Messages"]')); await settle(); press(q('#listView .mtabs button:last-child')); await settle();
      assert(q('.profile-card h3').textContent === 'First Persona', 'The phone-specific persona choice survives reopening');
      press(q('.edit-profile-btn')); await settle();
      press(all('.persona-pick-item').find((item) => item.querySelector('.persona-pick-name').textContent.startsWith('Preview User'))); await settle(200);
      const screenName = q('.profile-card .profile-field-input');
      value(screenName, 'Phone Screen Name'); screenName.focus(); screenName.blur(); await settle(300);
      assert(getContext().powerUserSettings.personas['chosen-persona.png'] === 'Preview User' && getContext().chatMetadata.mochios.phoneDataYaml.includes('nickname: Phone Screen Name'), 'Editing the phone screen name updates phone_data without renaming the ST persona');
      value(screenName, 'Preview User'); screenName.focus(); screenName.blur(); await settle(300);
      press(q('#listView .mtabs button:nth-child(3)')); await settle();
      press(q('.mochi-person-card')); await settle();
      assert(q('.mochi-person-info-dropdown').textContent.includes('Social Handle') && q('.mochi-person-info-dropdown').textContent.includes('preview_social'), 'People displays the canonical socialhandle value');
      press(q('.mochi-person-edit-trigger-btn')); await settle();
      const handle = q('.mochi-person-edit-form input[placeholder="@socialhandle"]');
      assert(handle?.value === 'preview_social', 'Social Handle editor hydrates from the new field');
      value(handle, '@updated_social'); press(q('.mochi-person-save-btn')); await settle(350);
      assert(/socialhandle:\s*["']?@updated_social/.test(getContext().chatMetadata.mochios.phoneDataYaml) && !getContext().chatMetadata.mochios.phoneDataYaml.includes('screenName:'), 'People edits persist socialhandle, not the retired screenName key');
      press(q('#listView .m-head > button:first-child')); await settle();
      press(q('#mochi-os-host .dock button:last-child')); await settle(200);
      press(q('.settings-nav-item:nth-child(4)')); await settle(200);
      const search = q('.format-guide-search-wrap'); const pills = q('.format-guides-category-pills');
      assert(search.getBoundingClientRect().bottom <= pills.getBoundingClientRect().top && search.parentElement.firstElementChild === search, 'Format-guide search sits above the category pills');
      const copy = q('.format-guide-copy-btn');
      assert(copy?.textContent.trim() === '📋' && copy.getBoundingClientRect().width <= 32 && copy.getAttribute('aria-label') === 'Copy Template', 'Copy Template is an accessible emoji-only button sized to its icon');
      for (const dismissal of ['close button', 'backdrop', 'Escape']) {
        if (!q('.overlay.show .modal-settings-split')) {
          press(q('#mochi-os-host .dock button:last-child'));
          await until(() => q('.overlay.show .modal-settings-split'), 'settings reopening');
        }
        const modal = q('.overlay.show .modal-settings-split');
        const overlay = modal.closest('.overlay');
        const sidebar = modal.querySelector('.settings-split-sidebar');
        const detail = modal.querySelector('.settings-split-content');
        assert(sidebar.querySelector('.settings-nav-item.active').textContent === 'Format Guides', 'Reopening settings preserves the selected section');
        sidebar.scrollLeft = sidebar.scrollWidth; sidebar.scrollTop = sidebar.scrollHeight;
        detail.scrollTop = detail.scrollHeight; await settle();
        if (dismissal === 'close button') press(modal.querySelector('.close'));
        else if (dismissal === 'backdrop') press(overlay);
        else key(document, 'Escape');
        // Check the next task, not after a fade-out or compositor repaint delay.
        await settle(0);
        assert(isMochiOsOpen() && !overlay.isConnected && !sidebar.isConnected && !detail.isConnected && !q('.modal-settings-split'), `${dismissal} removes settings and its scrolled sidebar immediately without closing the phone`);
      }
      report.textContent = `PASS: ${checks.length} requested-update checks at ${Math.round(viewport.width)} × ${Math.round(viewport.height)}.`;
      report.dataset.updateChecks = JSON.stringify(checks);
    } catch (error) {
      report.textContent = `FAIL after ${checks.length} requested-update checks: ${error.message}`;
      report.dataset.updateChecks = JSON.stringify(checks); console.error(error);
    } finally { control.disabled = false; }
  };

  button.onclick = async () => {
    const checks = [];
    const assert = (ok, description) => { if (!ok) throw new Error(description); checks.push(description); };
    button.disabled = true;
    report.textContent = 'Checking chat features with local mock replies…';
    try {
      closeMochiOs(); await settle(); preview.reset(); setKeyboard(false);
      delete getContext().extensionSettings.mochi_os.window;
      await getContext().printMessages(); refreshMochiWidgets(); openMochiOs(); await settle(450);
      await openThread('Preview Group');
      assert(incoming().length === 2, 'Group history has exactly two initial bubbles');
      assert(incoming().map((row) => row.querySelector('.mochi-msg-sender').textContent).join('|') === 'Preview Character|Other Character', 'Group bubbles retain their original timestamp-adjacent authors');
      assert(!q('.mochi-message-author') && !q('.mochi-message-identity') && incoming().every((row) => getComputedStyle(row).display === 'flex' && row.querySelector(':scope > .mini')?.getBoundingClientRect().width === 28), 'Original compact avatar/bubble rows are restored without an author rail');
      const first = incoming()[0];
      const bubble = first.querySelector('.b');
      const actionRow = first.querySelector('.msg-actions-trigger');
      const initial = { message: first.getBoundingClientRect(), bubble: bubble.getBoundingClientRect(), next: incoming()[1].getBoundingClientRect() };
      assert(Math.abs(first.querySelector('.mini').getBoundingClientRect().bottom - first.querySelector('.mochi-bubble-meta').getBoundingClientRect().bottom) < 1, 'Reserved controls keep the compact avatar beside its original bubble, not below the actions');
      pointer(bubble, 'pointerover'); pointer(bubble, 'pointermove'); await settle();
      assert(getComputedStyle(actionRow).visibility === 'hidden' && actionRow.inert, 'Hover does not activate message actions');
      press(bubble); await settle();
      assert(getComputedStyle(actionRow).visibility === 'visible' && !actionRow.inert, 'Bubble click reveals usable actions');
      assert(first.getBoundingClientRect().height === initial.message.height && bubble.getBoundingClientRect().top === initial.bubble.top && incoming()[1].getBoundingClientRect().top === initial.next.top, 'Revealing actions does not move content');
      assert(actionRow.parentElement.classList.contains('wmsg') && actionRow.getBoundingClientRect().top >= bubble.getBoundingClientRect().bottom && Math.abs(actionRow.getBoundingClientRect().left - actionRow.parentElement.getBoundingClientRect().left) < 1, 'Actions sit below and left-align with the message bubble');
      assert(getComputedStyle(first.querySelector('.mt')).position === 'static' && getComputedStyle(first.querySelector('.mochi-bubble-meta')).position === 'static' && first.querySelector('.mochi-bubble-meta').getBoundingClientRect().height > 0, 'Timestamp retains its original in-flow position beside the group sender');
      assert(getComputedStyle(actionRow).flexWrap === 'nowrap', 'Message actions remain on one horizontal row');
      assert(Math.abs(actionRow.getBoundingClientRect().top - first.querySelector('.mochi-bubble-meta').getBoundingClientRect().top) < 1, 'Only actions move to the original timestamp metadata top edge');
      assert(!all('.msg-actions-trigger button').some((control) => /translat/i.test(control.title)), 'Translate is absent from message actions');
      key(first, 'Escape'); await settle();
      assert(isMochiOsOpen() && !first.classList.contains('actions-visible'), 'Escape dismisses actions instead of closing Mochi');
      first.focus(); key(first, 'Enter'); await settle();
      assert(document.activeElement === first && !actionRow.inert && getComputedStyle(actionRow).visibility === 'visible', 'Keyboard Enter reveals bubble actions');
      key(first, ' '); await settle();
      actionRow.querySelector('button').focus();
      assert(actionRow.inert && document.activeElement === first, 'Hidden actions cannot receive keyboard focus');
      for (const pointerType of ['mouse', 'touch', 'pen']) {
        pointer(bubble, 'pointerdown', { pointerType }); await settle(560);
        pointer(bubble, 'pointerup', { pointerType }); bubble.click(); await settle();
        assert(q('.mochi-reply-preview')?.textContent.includes('Preview Character') && !first.classList.contains('actions-visible'), `${pointerType} long-press replies without opening actions`);
        press(q('.mochi-reply-preview button')); await settle();
      }
      for (const cancellation of ['movement', 'pointercancel', 'scroll']) {
        pointer(bubble, 'pointerdown', { pointerType: 'touch' });
        if (cancellation === 'movement') pointer(bubble, 'pointermove', { x: 80, y: 80, pointerType: 'touch' });
        else if (cancellation === 'scroll') q('#chatView .c-body').dispatchEvent(new Event('scroll'));
        else pointer(bubble, 'pointercancel', { pointerType: 'touch' });
        await settle(550); pointer(bubble, 'pointerup', { pointerType: 'touch' });
        if (cancellation === 'movement') bubble.click();
        await settle();
        assert(!q('.mochi-reply-preview') && !first.classList.contains('actions-visible'), `${cancellation} cancels long-press Reply`);
      }
      let transferBounds;
      for (let index = 0; index < 4; index++) {
        press(q('#plusBtn')); await settle(320);
        const transfer = q('#transferBtn');
        const bounds = transfer.getBoundingClientRect();
        const more = getComputedStyle(q('.plus-menu'));
        const controls = ['emojiBtn', 'micBtn', 'stickerBtn', 'transferBtn'].map((id) => q(`#${id}`));
        assert(more.display === 'flex' && more.flexDirection === 'column' && controls.every((control, position) => !position || control.getBoundingClientRect().top > controls[position - 1].getBoundingClientRect().top) && within(bounds), `More retains its original in-bounds vertical stack (${index + 1})`);
        const delays = controls.map((control) => parseFloat(getComputedStyle(control).transitionDelay));
        assert(delays[3] === 0 && delays[2] < delays[1] && delays[1] < delays[0] && parseFloat(getComputedStyle(transfer).transitionDuration) > 0, 'More buttons keep the original bottom-to-top staggered animation');
        if (transferBounds) assert(bounds.top === transferBounds.top && bounds.left === transferBounds.left, 'Transfer does not shift between openings');
        transferBounds = bounds; press(q('#plusBtn')); await settle(220);
        assert(q('.plus-menu').inert && getComputedStyle(transfer).opacity === '0' && getComputedStyle(transfer).transform !== 'none', 'Closed More buttons return to their original translated/scaled animation state');
      }
      press(q('#plusBtn')); await settle(); press(q('#transferBtn')); await settle();
      assert(q('.overlay.show .mochi-transfer-amount-row') && within(q('.overlay.show .modal').getBoundingClientRect()), 'Transfer opens a reachable modal');
      key(document, 'Escape'); await settle();
      assert(isMochiOsOpen() && !q('.overlay.show .mochi-transfer-amount-row'), 'Escape closes Transfer without leaving the chat');
      setKeyboard(true); await settle(250);
      press(q('#plusBtn')); await settle(140);
      assert(within(q('#transferBtn').getBoundingClientRect()), 'More and Transfer stay reachable above the mobile keyboard');
      press(q('#transferBtn')); await settle();
      assert(within(q('.overlay.show .modal').getBoundingClientRect()), 'Transfer modal fits the keyboard-reduced viewport');
      key(document, 'Escape'); setKeyboard(false); await settle(250);
      await openPicker();
      assert(all('.mochi-media-picker-tabs button').map((control) => control.textContent).join('|') === 'Emoji|Stickers' && !q('.mochi-media-close') && !q('.mochi-gif-tab') && !q('.mochi-kaomoji-grid'), 'Picker has exactly Emoji and Stickers, with no close button or extra sections');
      assert(q('.mochi-media-picker-body').scrollHeight > q('.mochi-media-picker-body').clientHeight, 'Emoji picker scrolls inside its bounded panel');
      press(q('.mochi-emoji-grid button[title="😀"]')); await settle();
      assert(q('#chatView .c-bar > input').value === '😀', 'Emoji selection inserts into the composer');
      key(q('#chatView .c-bar > input'), 'Enter'); await settle();
      assert(outgoing().length === 1 && outgoing()[0].textContent.includes('😀'), 'Emoji sends as one outgoing bubble');
      const userRow = outgoing()[0];
      press(userRow.querySelector('.b')); await settle();
      assert(!userRow.querySelector('.mini') && Math.abs(userRow.querySelector('.msg-actions-trigger').getBoundingClientRect().left - userRow.querySelector('.b').getBoundingClientRect().left) < 1, 'Outgoing bubbles retain the original no-avatar layout with left-aligned actions');
      await openPicker('Stickers');
      const file = await stickerFile();
      const priorNames = new Set(all('.mochi-sticker-send span').map((span) => span.textContent));
      await importFiles([file]);
      await until(() => all('.mochi-sticker-send span').some((span) => !priorNames.has(span.textContent)), 'persistent sticker import');
      const savedButton = all('.mochi-sticker-send').find((control) => !priorNames.has(control.querySelector('span').textContent));
      const name = savedButton.querySelector('span').textContent;
      // Remember the exact fixture-owned import even if a later assertion fails.
      sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ name }));
      // Browser inspection can keep the fixture in a background tab, where
      // IntersectionObserver-based lazy image loads wait for foregrounding.
      savedButton.querySelector('img').loading = 'eager';
      await until(() => savedButton.querySelector('img').naturalWidth > 0, 'sticker image decode');
      const backend = await savedStickers();
      const entry = backend.list.find((item) => item.name === name);
      assert(entry && (await backend.image(entry)).size === file.size, 'Imported image is saved in real global Mochi storage');
      const countBeforeInvalid = all('.mochi-sticker-cell').length;
      await importFiles([new File(['<svg onload="bad()"/>'], 'renamed.png', { type: 'image/png' })]);
      await until(() => q('.mochi-media-error'), 'invalid sticker rejection');
      assert(all('.mochi-sticker-cell').length === countBeforeInvalid, 'Renamed non-image input is rejected without changing the library');
      press(savedButton); await settle();
      assert(outgoing().length === 2 && outgoing()[1].querySelector('.sticker img')?.naturalWidth > 0, 'Saved sticker sends as an image bubble');
      await openPicker(); key(document, 'Escape'); await settle();
      assert(isMochiOsOpen() && !q('[data-conversation-media-picker]'), 'Escape dismisses the picker without closing the phone');
      const originalChatCount = getContext().chat.length;
      const lifecycleStart = preview.lifecycle.length;
      preview.mock([`<THINK>Offline hidden reasoning</THINK>\nUnrelated explanation.\n${groupReply(name)}\n<debug>Discard this</debug>\n<thinking>Trailing hidden reasoning</thinking>`]);
      press(q('#chatView .c-bar > button:last-child'));
      await until(() => preview.requests.length === 1, 'mock group request');
      sendText('Typed while reply pending'); await settle();
      await until(() => getContext().chat.length === originalChatCount + 1, 'group transcript save'); await settle(450);
      assert(incoming().length === 4 && outgoing().length === 3, 'Group reply hydrates once and preserves a concurrent user input');
      assert(!rows().some((row) => row.textContent.includes('Model echo')), 'Provider user echoes do not create duplicate bubbles');
      assert(getContext().chat.at(-1).mes.includes(name) && preview.requests.length === 1, 'Emoji and sticker inputs share one request and one transcript');
      assert(!/^\s*(?:-\s*)?id:/m.test(getContext().chat.at(-1).mes), 'Group generation writes no runtime or provider message ids into roleplay');
      assert(!/think|debug|Unrelated|hidden reasoning/i.test(getContext().chat.at(-1).mes), 'Generated roleplay turns automatically exclude reasoning and unrelated response content');
      assert(preview.lifecycle.slice(lifecycleStart).map((event) => event[0]).join('|') === 'MESSAGE_RECEIVED|render|CHARACTER_MESSAGE_RENDERED|save', 'The host receives, renders and saves once per response');
      const firstGroupTurn = getContext().chat.at(-1).mes;
      await openThread('Preview Contact');
      assert(incoming().length === 1 && outgoing().length === 0 && !q('.mochi-reply-preview'), 'Private and group conversation state stays separate');
      await openPicker('Stickers');
      assert(all('.mochi-sticker-send span').some((span) => span.textContent === name), 'Sticker library is shared with private chats');
      press(all('.mochi-sticker-send').find((control) => control.querySelector('span').textContent === name)); await settle();
      sendText('Private hello'); await settle();
      preview.mock(['<privatechat_history target="Preview Character" type="private">\nmessages:\n  - id: msg_001\n    t: text\n    c: Offline private reply\n</privatechat_history>\n<environment>\nweather: Rainy\n</environment>']);
      press(q('#chatView .c-bar > button:last-child'));
      await until(() => getContext().chat.length === originalChatCount + 2, 'private transcript save'); await settle(450);
      assert(incoming().length === 2 && outgoing().length === 2, 'Private replies stay in one transcript without duplicate bubbles');
      assert(getContext().chat.at(-1).mes.includes('target="Preview Character"') && !getContext().chat.at(-1).mes.includes('contactname:') && q('#chatView .c-head').textContent.includes('Preview Contact'), 'Private output uses target only while the phone reads its display alias from phone_data');
      assert(!/^\s*(?:-\s*)?id:/m.test(getContext().chat.at(-1).mes), 'Private generation also leaves message ids out of roleplay YAML');
      const privateTurn = getContext().chat.at(-1).mes;
      const privateReply = '<privatechat_history target="Preview Character" type="private">\nmessages:\n  - t: text\n    c: Regenerated private reply\n</privatechat_history>\n<environment>\nweather: Rainy\n</environment>';
      let privateLast = incoming().at(-1); press(privateLast.querySelector('.b')); await settle();
      preview.mock([privateReply]); press(privateLast.querySelector('button[title="Regenerate"]'));
      await until(() => getContext().chat.at(-1).swipes?.length === 2, 'private alias regeneration'); await settle(450);
      assert(getContext().chat.length === originalChatCount + 2 && incoming().length === 2 && outgoing().length === 2 && getContext().chat.at(-1).mes.includes('Regenerated private reply'), 'Renamed private contacts regenerate in place using a native swipe');
      privateLast = incoming().at(-1); press(privateLast.querySelector('.b')); await settle();
      press(privateLast.querySelector('.mochi-swipe-trigger button:first-child'));
      await until(() => getContext().chat.at(-1).swipe_id === 0, 'private previous swipe'); await settle(450);
      assert(getContext().chat.at(-1).mes === privateTurn && getContext().chat[originalChatCount].mes === firstGroupTurn, 'Private swipe restores its aliased transcript without touching the group');
      privateLast = incoming().at(-1); press(privateLast.querySelector('.b')); await settle();
      press(Array.from(privateLast.querySelectorAll('button')).find((control) => /branch/i.test(control.title)));
      await until(() => preview.lifecycle.some((event) => event[0] === 'command' && event[1] === `/branch-create ${originalChatCount + 1}`), 'private alias branch command');
      assert(getContext().chat.length === originalChatCount + 2 && preview.lifecycle.filter((event) => event[0] === 'command').length === 1, 'Branch from a renamed contact resolves exactly its complete host transcript');
      await openThread('Preview Group');
      preview.mock([groupReply(name)]); press(q('#chatView .c-bar > button:last-child'));
      await until(() => getContext().chat.length === originalChatCount + 3, 'second group transcript'); await settle(450);
      assert(getContext().chat[originalChatCount].mes === firstGroupTurn && incoming().length === 6 && outgoing().length === 3, 'Repeated response ids/text append a new turn without overwriting history');
      preview.mock([groupReply(name)]); press(q('#chatView .c-bar > button:last-child'));
      await until(() => getContext().chat.length === originalChatCount + 4, 'group continuation'); await settle(450);
      assert(incoming().length === 8 && outgoing().length === 3, 'Continuation adds replies but never invents user input');
      const beforeRegenerate = getContext().chat.length;
      const last = incoming().at(-1); press(last.querySelector('.sticker')); await settle();
      preview.mock([groupReply(name)]); press(last.querySelector('button[title="Regenerate"]'));
      await until(() => getContext().chat.at(-1).swipes?.length === 2, 'native regeneration swipe'); await settle(450);
      assert(getContext().chat.length === beforeRegenerate && incoming().length === 8 && outgoing().length === 3, 'Regeneration replaces a whole turn using native swipes');
      const restoredLast = incoming().at(-1); press(restoredLast.querySelector('.sticker')); await settle();
      const swipe = restoredLast.querySelector('.mochi-swipe-trigger');
      const actions = restoredLast.querySelector('.msg-actions-trigger');
      assert(swipe.parentElement === actions.parentElement && swipe.getBoundingClientRect().top >= actions.getBoundingClientRect().bottom + 3 && Math.abs(swipe.getBoundingClientRect().left - actions.getBoundingClientRect().left) < 1, 'Swipe controls occupy a separate row below and left-aligned with message actions');
      const swipeBounds = swipe.getBoundingClientRect();
      const swipeItems = Array.from(swipe.children).map((item) => item.getBoundingClientRect());
      assert(getComputedStyle(swipe).justifyContent === 'center' && swipeItems.every((bounds) => Math.abs(bounds.top + bounds.height / 2 - swipeBounds.top - swipeBounds.height / 2) < 1) && Math.abs(swipeItems[0].left + swipeItems.at(-1).right - swipeBounds.left - swipeBounds.right) < 2, 'Swipe buttons and counter are centered inside their container');
      press(restoredLast.querySelector('.mochi-swipe-trigger button:first-child')); await settle(450);
      assert(getContext().chat.at(-1).swipe_id === 0 && getContext().chat.length === beforeRegenerate, 'Previous swipe restores the transcript without creating a message');
      assert(q('#chatView .c-body').scrollWidth <= q('#chatView .c-body').clientWidth + 1 && all('#chatView .msg-actions-trigger').every((actions) => actions.scrollWidth <= actions.clientWidth + 1), 'Bubbles wrap and single-line action rows fit without horizontal overflow');
      const editable = incoming()[0]; press(editable.querySelector('.b')); await settle();
      press(editable.querySelector('button[title="Edit"]')); await settle();
      value(q('.mochi-message-edit-input'), 'Edited first group member'); key(q('.mochi-message-edit-input'), 'Enter');
      await until(() => getContext().chat[1].mes.includes('Edited first group member'), 'targeted bubble edit'); await settle(350);
      assert(getContext().chat[1].mes.startsWith('Preview prologue.') && getContext().chat[1].mes.endsWith('Preview epilogue.'), 'Editing a bubble preserves surrounding roleplay prose');
      assert(getContext().chat[1].mes.includes('Other Character') && getContext().chat[1].mes.includes('weather: Sunny') && getContext().chat[originalChatCount + 1].mes === privateTurn, 'Editing preserves other senders, environment and private history');

      // Check the displayed roleplay widget too, not just the backing YAML.
      const openInline = async (index) => {
        const selector = `#chat .mes[mesid="${index}"] .mochi-private-widget`;
        await until(() => q(selector), `inline roleplay widget ${index}`);
        if (!q(`${selector}.is-open`)) press(q(`${selector} .mochi-private-contact-open`));
        await settle();
        return q(selector);
      };
      const inlineGroup = await openInline(1);
      assert(inlineGroup.textContent.includes('Edited first group member'), 'Connected roleplay widget renders the saved group edit');
      const inlineContainer = inlineGroup.closest('.mochi-inline-blocks');
      getContext().chat[1].mes = getContext().chat[1].mes.replace('Edited first group member', 'Updated without replacing host DOM');
      await getContext().eventSource.emit('MESSAGE_UPDATED', 1);
      await until(() => inlineContainer.textContent.includes('Updated without replacing host DOM'), 'existing widget content refresh');
      assert(inlineContainer.isConnected && inlineContainer.querySelector('.is-open'), 'An already-open roleplay widget updates in place instead of retaining stale data');
      getContext().chat[1].mes = getContext().chat[1].mes.replace('Updated without replacing host DOM', 'Edited first group member');
      await getContext().eventSource.emit('MESSAGE_UPDATED', 1);
      await getContext().saveChat(); await settle(400);

      // Repeated provider text must still edit the later no-id record, not the first.
      const laterGroup = incoming().findLast((row) => row.querySelector('.b')?.textContent === 'Offline group reply');
      const earlierGroupTurns = getContext().chat.slice(0, -1).map((message) => message.mes);
      press(laterGroup.querySelector('.b')); await settle(); press(laterGroup.querySelector('button[title="Edit"]')); await settle();
      value(q('.mochi-message-edit-input'), 'Edited latest no-id group reply'); press(q('.mochi-message-edit-save'));
      await until(() => getContext().chat.at(-1).mes.includes('Edited latest no-id group reply'), 'latest repeated group edit'); await settle(350);
      assert(getContext().chat.slice(0, -1).every((message, index) => message.mes === earlierGroupTurns[index]) && getContext().chat.at(-1).swipes[0] === getContext().chat.at(-1).mes, 'Editing a repeated no-id group reply updates only its connected turn and active swipe');
      assert((await openInline(getContext().chat.length - 1)).textContent.includes('Edited latest no-id group reply'), 'Later connected group widget receives the same bubble edit');

      await openThread('Preview Contact');
      const privateEditable = incoming().at(-1); press(privateEditable.querySelector('.b')); await settle(); press(privateEditable.querySelector('button[title="Edit"]')); await settle();
      value(q('.mochi-message-edit-input'), 'Edited renamed private reply'); key(q('.mochi-message-edit-input'), 'Enter');
      await until(() => getContext().chat[originalChatCount + 1].mes.includes('Edited renamed private reply'), 'private alias edit'); await settle(350);
      const privateInline = await openInline(originalChatCount + 1);
      assert(getContext().chat[originalChatCount + 1].mes.includes('target="Preview Character"') && !getContext().chat[originalChatCount + 1].mes.includes('contactname:') && privateInline.textContent.includes('Edited renamed private reply') && privateInline.textContent.includes('Preview Contact'), 'Target-only private edits update the connected widget and retain the phone_data display alias');
      privateLast = incoming().at(-1); press(privateLast.querySelector('.b')); await settle(); press(privateLast.querySelector('button[title="Edit"]')); await settle();
      value(q('.mochi-message-edit-input'), 'Offline private reply'); key(q('.mochi-message-edit-input'), 'Enter');
      await until(() => getContext().chat[originalChatCount + 1].mes.includes('c: Offline private reply'), 'restore private fixture edit'); await settle(350);
      await openThread('Preview Group');
      const reacted = incoming()[0]; press(reacted.querySelector('.b')); await settle();
      press(reacted.querySelector('.mochi-reaction-add > button')); await settle();
      press(reacted.querySelector('.mochi-reaction-add-popover button:first-child'));
      await until(() => getContext().chat[1].mes.includes('👍'), 'reaction persistence');
      press(q('#chatView .c-head > button:first-child')); await settle();
      press(q('#listView .mtabs button:last-child')); await settle();
      assert(q('.profile-card') && !q('.profile-status-section'), 'Profile status section is removed');
      press(q('#listView .m-head > button:first-child')); await settle();
      press(q('#mochi-os-host .dock button:last-child')); await settle(250);
      assert(!q('.settings-split-resizer') && within(q('.overlay.show .modal-settings-split').getBoundingClientRect()), 'Settings retains the original layout without an added resize control');
      const sidebar = q('.overlay.show .settings-split-sidebar');
      assert(getComputedStyle(sidebar).display === 'flex' && getComputedStyle(sidebar).flexDirection === 'row' && sidebar.scrollWidth > sidebar.clientWidth && sidebar.scrollHeight <= sidebar.clientHeight + 1, 'Phone settings uses the original horizontally scrollable section strip, not a grid');
      const activeSection = sidebar.querySelector('.settings-nav-item.active').textContent;
      const sidebarBounds = sidebar.getBoundingClientRect();
      const dragStart = { x: sidebarBounds.right - 20, y: sidebarBounds.top + sidebarBounds.height / 2 };
      const dragEnd = { x: sidebarBounds.left + 15, y: dragStart.y };
      pointer(sidebar, 'pointerdown', dragStart); pointer(window, 'pointermove', dragEnd); pointer(window, 'pointerup', dragEnd); sidebar.querySelector('.settings-nav-item').click(); await settle();
      assert(sidebar.scrollLeft > 0 && sidebar.querySelector('.settings-nav-item.active').textContent === activeSection && !sidebar.classList.contains('is-dragging'), 'Desktop hold-and-drag scrolls the original strip without accidentally switching sections');
      const lastSection = sidebar.querySelector('.settings-nav-item:last-child');
      press(lastSection); await settle();
      assert(lastSection.classList.contains('active'), 'Sections remain clickable after desktop dragging');
      sidebar.scrollLeft = 0; press(sidebar.querySelector('.settings-nav-item')); await settle();
      pointer(sidebar, 'pointerdown', { ...dragStart, pointerType: 'touch' }); pointer(window, 'pointermove', { ...dragEnd, pointerType: 'touch' }); pointer(window, 'pointercancel', { ...dragEnd, pointerType: 'touch' });
      assert(!sidebar.classList.contains('is-dragging') && getComputedStyle(sidebar).overflowX === 'auto', 'Mobile touch keeps native sidebar swipe scrolling');
      const detail = q('.overlay.show .settings-split-content');
      detail.scrollTop = detail.scrollHeight; await settle();
      assert((detail.scrollTop > 0 || detail.scrollHeight <= detail.clientHeight) && getComputedStyle(detail).overflowY === 'auto' && detail.scrollWidth <= detail.clientWidth + 1, 'Settings detail scrolls independently when needed without horizontal overflow');
      if (viewport.width >= 700) {
        const host = q('#mochi-os-host'); const width = host.style.width; host.style.width = '680px';
        await until(() => getComputedStyle(sidebar).flexDirection === 'column', 'original wide sidebar layout');
        assert(sidebar.getBoundingClientRect().width === 220 && getComputedStyle(sidebar.parentElement).flexDirection === 'row' && !q('.settings-split-resizer'), 'Wide settings restores the original 220px sidebar beside its detail pane');
        const body = sidebar.parentElement; const height = body.style.height; const flex = body.style.flex;
        body.style.flex = '0 0 100px'; body.style.height = '100px'; await settle();
        const top = sidebar.scrollTop;
        pointer(sidebar, 'pointerdown', { x: 50, y: 90 }); pointer(window, 'pointermove', { x: 50, y: 25 }); pointer(window, 'pointerup', { x: 50, y: 25 }); await settle();
        assert(sidebar.scrollTop > top && getComputedStyle(sidebar).width === '220px', 'Desktop dragging scrolls a vertical sidebar without resizing it');
        body.style.height = height; body.style.flex = flex; host.style.width = width;
        await until(() => getComputedStyle(sidebar).flexDirection === 'row', 'original phone section strip');
      }
      setKeyboard(true); await settle(250);
      assert(within(q('.overlay.show .modal-settings-split').getBoundingClientRect()) && q('.overlay.show .settings-split-content').clientHeight > 0, 'Settings content remains accessible above the mobile keyboard');
      setKeyboard(false); await settle(); key(document, 'Escape'); await settle();
      assert(isMochiOsOpen() && !q('.modal-settings-split') && !sidebar.isConnected, 'Escape removes settings and its scrolled sidebar before returning home');
      const saved = { chatId: getContext().chatId, chat: getContext().chat, metadata: getContext().chatMetadata };
      await preview.switchChat('other-preview-chat'); await settle(450); await openThread('Preview Group'); await openPicker('Stickers');
      assert(rows().length === 0 && !q('.mochi-reply-preview') && all('.mochi-sticker-send span').some((span) => span.textContent === name), 'Host chat switch clears conversation state but retains global stickers');
      await preview.restore(saved); await getContext().printMessages(); await settle(450); await openThread('Preview Group');
      assert(q('#chatView .mochi-reaction-row')?.textContent.includes('👍') && outgoing().some((row) => row.querySelector('.sticker img')?.naturalWidth > 0), 'Saved reactions and sticker bubbles restore after a chat switch');

      // Native roleplay deletions must reconcile every thread without closing or
      // reloading Mochi. Keep a surviving older record and a pending input too.
      const savedHistory = { chatId: getContext().chatId, chat: structuredClone(getContext().chat), metadata: structuredClone(getContext().chatMetadata) };
      const nativeDelete = async (predicate) => {
        const host = getContext();
        for (let index = host.chat.length - 1; index >= 0; index--) if (predicate(host.chat[index], index)) host.chat.splice(index, 1);
        await host.printMessages();
        await host.eventSource.emit('MESSAGE_DELETED', host.chat.length);
        await host.saveChat();
        await settle(450);
      };
      const historyCount = getContext().chat.length;
      for (let index = 0; index < 24; index++) getContext().chat.push({ name: 'Preview Character', is_user: false, mes: `Ordinary roleplay turn ${index}`, extra: {} });
      await getContext().printMessages();
      await getContext().eventSource.emit('CHARACTER_MESSAGE_RENDERED', getContext().chat.length - 1);
      await settle(450);
      assert(incoming().length === 8 && outgoing().length === 3, 'Surviving phone history remains visible beyond the roleplay message page boundary');
      await nativeDelete((_message, index) => index >= historyCount);
      const deletionCount = getContext().chat.length;
      const latestGroupReply = incoming().at(-1);
      press(latestGroupReply.querySelector('.sticker')); await settle();
      press(latestGroupReply.querySelector('button[title="Delete"]'));
      await until(() => incoming().length === 7, 'saved group bubble deletion'); await settle(350);
      assert(getContext().chat.length === deletionCount && getContext().chat.at(-1).mes.includes('Edited latest no-id group reply') && !getContext().chat.at(-1).mes.includes(`c: ${name}`), 'Mochi bubble deletion immediately shows the remaining edited reply in the same roleplay turn');
      await nativeDelete((_message, index) => index === deletionCount - 1);
      assert(incoming().length === 6 && outgoing().length === 3, 'Native deletion of the latest group turn shows the latest surviving group messages without refresh');
      await nativeDelete((message, index) => index >= originalChatCount && /(?:chat_history|groupchat_history) target="Preview Group"/.test(message.mes));
      assert(incoming().length === 2 && outgoing().length === 0 && incoming()[0].textContent.includes('Edited first group member'), 'Deleting later roleplay turns restores the original surviving group history');
      press(q('#chatView .c-head > button:first-child')); await settle();
      const groupPreview = all('#listView .crow').find((row) => row.querySelector('.info b')?.textContent === 'Preview Group');
      assert(groupPreview.querySelector('.info > span').textContent.includes('Another long reply'), 'Conversation preview immediately uses the latest surviving message');
      await openThread('Preview Group');
      await nativeDelete((message) => /(?:chat_history|groupchat_history) target="Preview Group"/.test(message.mes));
      assert(rows().length === 0 && q('#chatView .notice')?.textContent.includes('No messages'), 'Deleting the final group record clears the open phone thread even while private records remain');
      await openThread('Preview Contact');
      assert(incoming().length === 2 && outgoing().length === 2, 'Group roleplay deletion does not affect the private conversation');
      sendText('Pending after roleplay deletion'); await settle();
      await nativeDelete(() => true);
      assert(incoming().length === 0 && outgoing().length === 1 && outgoing()[0].textContent.includes('Pending after roleplay deletion'), 'Deleting all roleplay history clears stale replies while retaining only unsaved user input');
      press(outgoing()[0].querySelector('.b')); await settle();
      press(outgoing()[0].querySelector('button[title="Delete"]')); await settle();
      assert(rows().length === 0, 'An unsaved input can be deleted immediately after clearing roleplay history');
      await preview.restore(savedHistory); await getContext().printMessages(); await settle(450); await openThread('Preview Group');
      sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ name }));
      report.dataset.viewport = JSON.stringify({ layoutWidth: innerWidth, layoutHeight: innerHeight, visibleWidth: viewport.width, visibleHeight: viewport.height, documentWidth: document.documentElement.clientWidth });
      report.textContent = `PASS: ${checks.length} chat/UI checks at ${Math.round(viewport.width)} × ${Math.round(viewport.height)} — reload this page, then run the saved-sticker check.`;
      report.dataset.checks = JSON.stringify(checks);
    } catch (error) {
      report.textContent = `FAIL after ${checks.length} checks: ${error.message}`;
      report.dataset.checks = JSON.stringify(checks); console.error(error);
    } finally { preview.replies = null; button.disabled = false; }
  };

  q('#test-reload').onclick = async () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(RELOAD_KEY) || 'null');
      if (!saved) throw new Error('Run the chat feature check before reloading');
      await openThread('Preview Group');
      await until(() => outgoing().some((row) => row.querySelector('.sticker img')?.naturalWidth > 0), 'reloaded sticker bubbles');
      await openPicker('Stickers');
      await until(() => all('.mochi-sticker-send span').some((span) => span.textContent === saved.name), 'reloaded global sticker library');
      const cell = all('.mochi-sticker-cell').find((item) => item.querySelector('span').textContent === saved.name);
      cell.querySelector('img').loading = 'eager';
      await until(() => cell.querySelector('img').naturalWidth > 0, 'reloaded sticker image');
      const backend = await savedStickers();
      if (!backend.list.some((item) => item.name === saved.name)) throw new Error('Saved sticker is missing from persistent storage');
      press(cell.querySelector('.mochi-sticker-delete'));
      await until(() => !all('.mochi-sticker-send span').some((span) => span.textContent === saved.name), 'test sticker removal');
      if ((await savedStickers()).list.some((item) => item.name === saved.name)) throw new Error('Removed test sticker remains in persistent storage');
      sessionStorage.removeItem(RELOAD_KEY);
      report.textContent = 'PASS: sticker library and transcript images survive a real page reload; imported test sticker removed from Mochi storage.';
    } catch (error) { report.textContent = `FAIL: ${error.message}`; console.error(error); }
  };
}
