/** Isolated UI fixture. Reads only this extension; never uses a live ST session. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as stickerPlugin from '../sticker-storage.mjs';
import { createStickerFixture } from './sticker-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.MOCHI_PREVIEW_PORT || 8127);
const temporaryRoot = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
const fixtureRoot = fs.mkdtempSync(path.join(temporaryRoot, 'mochi-disk-preview-'));
const extensionRoot = path.join(fixtureRoot, 'public/scripts/extensions/third-party/mochi-os');
fs.mkdirSync(extensionRoot, { recursive: true });
fs.copyFileSync(path.join(root, 'manifest.json'), path.join(extensionRoot, 'manifest.json'));
const stickerFixture = createStickerFixture(stickerPlugin, { serverRoot: fixtureRoot, user: {
  profile: { handle: 'preview', admin: true }, directories: { extensions: path.join(fixtureRoot, 'data/preview/extensions') },
} });
const context = `
const initialMetadata = { mochios: { phoneDataYaml: 'phone_data:\\n  user:\\n    nickname: Preview User\\n  characters:\\n    - id: preview.png\\n      name: Preview Character\\n      contactname: Preview Contact\\n      socialhandle: preview_social\\n  groups:\\n    - id: preview-group\\n      name: Preview Group\\n      main_members: [Preview Character, Other Character]' } };
const settings = JSON.parse(localStorage.getItem('mochi-preview-extension-settings') || 'null') || { disabledExtensions: [], mochi_os: {} };
const listeners = new Map();
const privateContent = '<privatechat_history target="Preview Character" type="private">\\ndate: Today\\ntime: "12:00"\\nmessages:\\n  - t: text\\n    c: A long message that should wrap comfortably inside the phone without horizontal scrolling. https://example.test/this-is-a-very-long-unbroken-address-to-check-wrapping\\n</privatechat_history>\\n<environment>\\ndate: Today\\ntime: "12:00"\\nweather: Sunny\\n</environment>';
const groupContent = '<groupchat_history target="Preview Group">\\nname: Preview Group\\ndate: Today\\ntime: "12:01"\\nmembers: 2\\nmessages:\\n  - t: text\\n    c: Hello from the first group member.\\n    sender: {name: Preview Character}\\n  - t: text\\n    c: Another long reply from the other group member, kept within the phone width even on a small device.\\n    sender: {name: Other Character}\\n</groupchat_history>\\n<environment>\\ndate: Today\\ntime: "12:01"\\nweather: Sunny\\n</environment>';
const initialChat = [{ name: 'Preview Character', is_user: false, mes: privateContent, extra: {} }, { name: 'Other Character', is_user: false, mes: 'Preview prologue.\\n\\n' + groupContent + '\\n\\nPreview epilogue.', extra: {} }];
let state = JSON.parse(sessionStorage.getItem('mochi-preview-chat-state') || 'null') || { chatId: 'preview-chat', chat: initialChat, metadata: initialMetadata };
const persist = () => sessionStorage.setItem('mochi-preview-chat-state', JSON.stringify(state));
const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function renderMessage(message, index) {
  const element = document.createElement('article');
  element.className = 'mes'; element.setAttribute('mesid', index);
  const name = document.createElement('strong'); name.textContent = message.name;
  const text = document.createElement('div'); text.className = 'mes_text'; text.innerHTML = escape(message.mes);
  element.append(name, text);
  const existing = document.querySelector('#chat .mes[mesid="' + index + '"]');
  if (existing) existing.replaceWith(element); else document.querySelector('#chat').append(element);
}
export const preview = {
  lifecycle: [], requests: [], replies: null,
  reset() { state = { chatId: 'preview-chat', chat: structuredClone(initialChat), metadata: structuredClone(initialMetadata) }; this.lifecycle.length = 0; this.requests.length = 0; this.replies = null; persist(); },
  mock(replies) { this.replies = [...replies]; },
  async switchChat(id) { state = { chatId: id, chat: [], metadata: structuredClone(initialMetadata) }; persist(); await getContext().eventSource.emit('CHAT_CHANGED'); },
  async restore(saved) { state = structuredClone(saved); persist(); await getContext().eventSource.emit('CHAT_CHANGED'); },
};
async function mockRequest(options) {
  if (!preview.replies) throw new Error('Offline UI fixture: generation disabled');
  const reply = preview.replies.shift();
  if (!reply) throw new Error('Offline UI fixture: no mock response queued');
  preview.requests.push(options);
  await new Promise((resolve) => setTimeout(resolve, 250));
  return reply;
}
export function getContext() {
  return {
    characters: [{ avatar: 'preview.png', name: 'Preview Character', chat: 'preview-chat', data: { name: 'Preview Character', description: 'Offline preview character' } }, { avatar: 'other.png', name: 'Other Character', data: { name: 'Other Character' } }],
    characterId: 0, groupId: null, chatId: state.chatId, chat: state.chat, groups: [],
    name1: 'Preview User', name2: 'Preview Character', chatMetadata: state.metadata,
    getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'offline-preview' }),
    powerUserSettings: { personas: { 'first-persona.png': 'First Persona', 'chosen-persona.png': 'Preview User' }, persona_descriptions: { 'first-persona.png': { title: 'Not selected', description: 'First test persona' }, 'chosen-persona.png': { title: 'Roleplay persona', description: 'The selected roleplay persona' } }, default_persona: 'first-persona.png' }, extensionSettings: settings,
    updateChatMetadata(patch) { Object.assign(state.metadata, patch); },
    saveMetadataDebounced: persist, saveSettingsDebounced() { localStorage.setItem('mochi-preview-extension-settings', JSON.stringify(settings)); },
    async saveChat() { persist(); preview.lifecycle.push(['save']); },
    addOneMessage(message, options) { const index = options?.forceId ?? state.chat.indexOf(message); renderMessage(message, index); preview.lifecycle.push(['render', index]); },
    updateMessageBlock(index) { renderMessage(state.chat[index], index); },
    async printMessages() { document.querySelector('#chat').replaceChildren(); state.chat.forEach(renderMessage); },
    async callGenericPopup(body, type) { preview.lifecycle.push(['popup', type, body]); return 1; },
    async executeSlashCommandsWithOptions(command) { preview.lifecycle.push(['command', command]); return ''; },
    SlashCommandParser: { addCommandObject() {} }, SlashCommand: { fromProps: (props) => props },
    eventTypes: {}, eventSource: {
      on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeListener(name, fn) { listeners.get(name)?.delete(fn); },
      async emit(name, ...args) { preview.lifecycle.push([name, ...args]); for (const fn of [...(listeners.get(name) ?? [])]) await fn(...args); },
    },
    getWorldInfoNames: () => [], loadWorldInfo: async () => null,
    substituteParams: (text) => text,
    messageFormatting: escape,
    ConnectionManagerRequestService: {
      getSupportedProfiles: () => [{ id: 'preview-one', name: 'Preview saved profile', model: 'Offline test model' }],
      sendRequest: async (_id, messages, _maxTokens, options) => ({ content: await mockRequest({ messages, ...options }) }),
    },
    generateRaw: mockRequest,
  };
}
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Mochi OS — isolated UI test</title><link rel="stylesheet" href="/style.css"><style>
body{margin:0;background:#252525;color:#ddd;font-family:system-ui}#top-bar{height:40px;max-width:720px;margin:auto;background:#1c1c1c;padding:0 12px;box-sizing:border-box;display:flex;align-items:center;font-size:12px}#preview-status{padding:12px;font-size:14px}#preview-tools{position:fixed;right:8px;bottom:8px;z-index:4001;background:#252525;display:flex;flex-wrap:wrap;gap:4px;max-width:230px}#extensions_settings2{max-width:280px;margin:12px}.inline-drawer-header{display:flex;justify-content:space-between;padding:8px;cursor:pointer;background:#333}.inline-drawer-content{display:none;padding:8px;background:#303030}.checkbox_label{display:flex;gap:8px;align-items:center}#chat{max-width:720px;margin:auto}.mes{padding:10px;border-bottom:1px solid #444}.mes_text{min-width:0}button{cursor:pointer}
/* Simulate a mobile host theme's decorative heading rule. Mochi's persona name must remain plain. */
@media(max-width:700px){h3{border-left:3px solid hotpink;padding-left:8px}h3::before{content:"";display:inline-block;width:3px;height:1em;background:hotpink}}
/* Host message image rules must not make embedded stickers square. */
#chat .mes_text img{border-radius:0}
.preview-small :is(#chat,#top-bar){max-width:320px}
</style></head><body><div id="top-bar">Offline Mochi OS test — no live API calls</div><div id="preview-status"></div><div id="extensions_settings2"></div><div id="extensionsMenu"></div><div id="chat"></div><div id="preview-tools"><button id="reopen">Reopen</button><button id="test-saved">Saved API</button><button id="test-default">Default API</button><button id="test-keyboard">Keyboard viewport</button><button id="test-reset-viewport">Full viewport</button><button id="test-layout">Check responsive controls</button><button id="test-updates">Check requested updates</button><button id="test-stickers">Check sticker management</button><button id="test-features">Check chat features</button><button id="test-reload">Check saved stickers after reload</button><button id="test-browser-small">Use 320 × 568 test viewport</button></div><script type="module">
import { ready, openMochiOs, closeMochiOs, isMochiOsOpen, refreshMochiWidgets } from '/app.js';
import { init } from '/index.js';
import { getContext, preview } from '/scripts/st-context.js';
import { installPreviewRegressions } from '/scripts/preview-regressions.js';
window.toastr={error:console.error,success:console.log,info:console.log};
// The inspection panel may keep its tab in the background, where native RAF is
// suspended. Timer-backed frames keep this isolated fixture's checks runnable.
window.requestAnimationFrame=(callback)=>setTimeout(()=>callback(performance.now()),16);
window.cancelAnimationFrame=clearTimeout;
const NativeResizeObserver = window.ResizeObserver;
window.__mochiPreviewLayout = { created: 0, disconnected: 0 };
window.ResizeObserver = class {
  constructor(callback) {
    window.__mochiPreviewLayout.created++;
    this.targets = new Map();
    this.callback = callback;
    this.native = new NativeResizeObserver((entries)=>callback(entries,this));
  }
  observe(target) {
    this.native.observe(target); this.targets.set(target, '');
    this.timer ??= setInterval(()=>{
      const entries=[];
      for (const [element, previous] of this.targets) {
        const dimensions=element.clientWidth+':'+element.clientHeight;
        if (previous!==dimensions) { this.targets.set(element,dimensions);entries.push({target:element,contentRect:element.getBoundingClientRect()}); }
      }
      if (entries.length) this.callback(entries,this);
    },100);
  }
  unobserve(target) { this.native.unobserve(target);this.targets.delete(target); }
  disconnect() { window.__mochiPreviewLayout.disconnected++;this.native.disconnect();this.targets.clear();clearInterval(this.timer);this.timer=null; }
};
const nativeViewport = window.visualViewport;
const simulatedViewport = new EventTarget();
let keyboard = false;
let smallViewport = false;
for (const property of ['width','height','offsetLeft','offsetTop']) Object.defineProperty(simulatedViewport, property, {get:()=> property === 'width' && smallViewport ? Math.min(innerWidth, 320) : property === 'height' && keyboard ? Math.min(nativeViewport?.height || innerHeight, 340) : property === 'height' && smallViewport ? Math.min(innerHeight, 568) : nativeViewport?.[property] ?? (property === 'width' ? innerWidth : property === 'height' ? innerHeight : 0)});
Object.defineProperty(window, 'visualViewport', {value:simulatedViewport, configurable:true});
nativeViewport?.addEventListener('resize', ()=>simulatedViewport.dispatchEvent(new Event('resize')));
nativeViewport?.addEventListener('scroll', ()=>simulatedViewport.dispatchEvent(new Event('scroll')));
document.querySelector('#test-keyboard').onclick=()=>{keyboard=true;simulatedViewport.dispatchEvent(new Event('resize'));};
document.querySelector('#test-reset-viewport').onclick=()=>{keyboard=false;simulatedViewport.dispatchEvent(new Event('resize'));};
document.querySelector('#test-browser-small').onclick=()=>{smallViewport=!smallViewport;document.documentElement.classList.toggle('preview-small',smallViewport);simulatedViewport.dispatchEvent(new Event('resize'));};
document.addEventListener('click', (event)=>{
  const header=event.target.closest('.inline-drawer-toggle');
  if (!header) return;
  const content=header.parentElement.querySelector('.inline-drawer-content');
  content.style.display=content.style.display==='block'?'none':'block';
});
await ready; await getContext().printMessages(); await init(); openMochiOs(); document.querySelector('#reopen').onclick=openMochiOs;
function testSelection(value) {
  const selected=document.querySelector('#mochi-api-profile');
  if (!selected) return;
  selected.value=value; selected.dispatchEvent(new Event('change', {bubbles:true}));
  setTimeout(()=>{
    const settings=JSON.parse(localStorage.getItem('mochi-os-settings'));
    document.querySelector('#preview-status').textContent=settings?.connectionProfileId===(value||null) ? 'PASS: selection persisted — '+(value||'default') : 'FAIL: selection persistence';
  },100);
}
document.querySelector('#test-saved').onclick=()=>testSelection('preview-one');
document.querySelector('#test-default').onclick=()=>testSelection('');
const settled = () => new Promise((resolve)=>setTimeout(resolve, 100));
installPreviewRegressions({ getContext, preview, openMochiOs, closeMochiOs, isMochiOsOpen, refreshMochiWidgets, viewport: simulatedViewport, setKeyboard(value) { keyboard=value;simulatedViewport.dispatchEvent(new Event('resize')); } });
document.querySelector('#test-layout').onclick=async()=>{
  const checks=[];
  const assert=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
  const rect=()=>document.querySelector('#mochi-os-host').getBoundingClientRect();
  const within=(bounds)=>bounds.left>=-1&&bounds.top>=-1&&bounds.right<=simulatedViewport.width+1&&bounds.bottom<=simulatedViewport.height+1;
  const pointer=(target,type,x,y)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:51,isPrimary:true,button:0,clientX:x,clientY:y}));
  try {
    keyboard=false;simulatedViewport.dispatchEvent(new Event('resize'));
    closeMochiOs();await settled();
    delete getContext().extensionSettings.mochi_os.window;
    openMochiOs();await settled();
    const original=rect();
    const topbar=document.querySelector('#top-bar').getBoundingClientRect();
    assert(within(original),'Initial popup is in bounds');
    const desiredLeft=topbar.left+(topbar.width-original.width)/2;
    const centredLeft=Math.max(12,Math.min(simulatedViewport.width-original.width-12,desiredLeft));
    assert(Math.abs(original.left-centredLeft)<1,'Initial popup follows top-bar centre, clamped to visible edges');
    keyboard=true;simulatedViewport.dispatchEvent(new Event('resize'));await settled();
    assert(within(rect())&&rect().width===original.width&&rect().height<original.height,'Keyboard keeps reading width and fits available height');
    document.querySelector('button[aria-label="Messages"]').click();await settled();
    const group=document.querySelector('#listView .crow');
    assert(group&&within(group.getBoundingClientRect()),'Conversation list remains reachable above keyboard');
    group.click();await settled();
    const body=document.querySelector('#chatView .c-body');
    assert(body.scrollWidth<=body.clientWidth+1,'Group conversation has no horizontal scrolling');
    const input=document.querySelector('#chatView .c-bar input');
    assert(within(input.getBoundingClientRect())&&parseFloat(getComputedStyle(input).fontSize)>=16,'Composer remains visible and readable');
    keyboard=false;simulatedViewport.dispatchEvent(new Event('resize'));await settled();
    const handle=document.querySelector('button[aria-label="Move Mochi OS"]');
    const start=handle.getBoundingClientRect();
    pointer(handle,'pointerdown',start.left+20,start.top+20);
    pointer(window,'pointermove',9999,9999);pointer(window,'pointerup',9999,9999);
    const moved=rect();
    assert(within(moved),'Popup drag clamps to screen edges');
    const saved=JSON.stringify(getContext().extensionSettings.mochi_os.window);
    keyboard=true;simulatedViewport.dispatchEvent(new Event('resize'));await settled();
    assert(JSON.stringify(getContext().extensionSettings.mochi_os.window)===saved,'Keyboard adjustment does not overwrite saved position');
    keyboard=false;simulatedViewport.dispatchEvent(new Event('resize'));await settled();
    closeMochiOs();await settled();openMochiOs();await settled();
    assert(Math.abs(rect().left-moved.left)<1&&Math.abs(rect().top-moved.top)<1,'Popup position is restored on reopen');
    closeMochiOs();await settled();
    const bubble=document.querySelector('#mochi-os-launcher');
    const bubbleStart=bubble.getBoundingClientRect();
    pointer(bubble,'pointerdown',bubbleStart.left+20,bubbleStart.top+20);
    pointer(window,'pointermove',-9999,-9999);pointer(window,'pointerup',-9999,-9999);
    bubble.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));await settled();
    assert(within(bubble.getBoundingClientRect())&&!isMochiOsOpen(),'Bubble drag clamps without opening the phone');
    assert(Boolean(getContext().extensionSettings.mochi_os.bubblePosition),'Bubble drag position is saved');
    const toggle=document.querySelector('#mochi_os_show_bubble');
    toggle.checked=false;toggle.dispatchEvent(new Event('change',{bubbles:true}));
    assert(!document.querySelector('#mochi-os-launcher'),'Extension drawer hides the bubble');
    document.querySelector('#mochi_os_wand_entry').click();await settled();
    assert(isMochiOsOpen(),'Wand entry still opens Mochi with bubble disabled');
    const settings=document.querySelector('#mochi-os-host .dock button:last-child');
    settings.click();await settled();
    document.querySelector('button[aria-label="Ocean blue"]').click();await settled();
    toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}));await settled();
    assert(getComputedStyle(document.querySelector('#mochi-os-launcher')).getPropertyValue('--mochi-launcher-accent').trim()===getComputedStyle(document.querySelector('#mochi-os-host .mochi-scope')).getPropertyValue('--acc').trim(),'Floating bubble matches the active phone accent');
    closeMochiOs();await settled();
    toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}));
    assert(Boolean(document.querySelector('#mochi-os-launcher')),'Extension drawer restores the bubble');
    document.querySelector('#preview-status').textContent='PASS: '+checks.length+' responsive UI checks — '+checks.join('; ');
  } catch(error) { document.querySelector('#preview-status').textContent='FAIL: '+error.message;console.error(error); }
};
</script></body></html>`;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.startsWith('/api/plugins/mochi-os-stickers/')) {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = await stickerFixture.fetch(url.href, { method: request.method, headers: request.headers, body: chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); }
    return;
  }
  if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
  if (url.pathname === '/scripts/st-context.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(context); return; }
  if (url.pathname === '/script.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('export const amount_gen=512; export function getMaxContextTokens(){return 32768;} export function getMaxResponseTokens(){return 4096;} export function createRawPrompt(messages){return messages;}'); return; }
  if (url.pathname === '/scripts/world-info.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('export const selected_world_info=[]; export function getWorldInfoSettings(){return {world_info:{globalSelect:[],charLore:[]}};}'); return; }
  if (url.pathname === '/scripts/personas.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('export const user_avatar="chosen-persona.png";'); return; }
  if (url.pathname === '/scripts/extensions/regex/engine.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('export const regex_placement={USER_INPUT:1,AI_OUTPUT:2}; export function getRegexedString(text){return text;}'); return; }
  if (url.pathname === '/scripts/chats.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('export async function appendFileContent(message,text){return text;}'); return; }
  if (/^\/characters\/(?:preview|other)\.png$/.test(url.pathname)) { response.setHeader('Content-Type', 'image/png'); response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')); return; }
  if (/^\/User%20Avatars\/(?:first|chosen)-persona\.png$/.test(url.pathname)) { response.setHeader('Content-Type', 'image/png'); response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')); return; }
  const file = { '/index.js': 'index.js', '/app.js': 'app.js', '/style.css': 'style.css', '/scripts/preview-regressions.js': 'scripts/preview-regressions.js' }[url.pathname];
  if (!file) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
  fs.createReadStream(path.join(root, file)).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Isolated preview: http://127.0.0.1:${port}\nTemporary sticker extension: ${extensionRoot}`));

async function stop() {
  server.close();
  await stickerPlugin.exit();
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
