/** Isolated UI fixture. Reads only this extension; never uses a live ST session. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const context = `
const metadata = { mochios: { phoneDataYaml: 'phone_data:\\n  user:\\n    nickname: Preview User\\n  characters:\\n    - id: preview\\n      name: Preview Character\\n      nickname: Preview Contact' } };
const settings = { disabledExtensions: [], mochi_os: {} };
const listeners = new Map();
export function getContext() {
  return {
    characters: [{ avatar: 'preview.png', name: 'Preview Character', chat: 'preview-chat', data: { name: 'Preview Character', description: 'Offline preview character' } }],
    characterId: 0, groupId: null, chatId: 'preview-chat', chat: [], groups: [],
    name1: 'Preview User', name2: 'Preview Character', chatMetadata: metadata,
    powerUserSettings: { personas: {}, persona_descriptions: {} }, extensionSettings: settings,
    updateChatMetadata(patch) { Object.assign(metadata, patch); },
    saveMetadataDebounced() {}, saveSettingsDebounced() {}, async saveChat() {},
    eventTypes: {}, eventSource: {
      on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeListener(name, fn) { listeners.get(name)?.delete(fn); },
    },
    getWorldInfoNames: () => [], loadWorldInfo: async () => null,
    substituteParams: (text) => text,
    ConnectionManagerRequestService: {
      getSupportedProfiles: () => [{ id: 'preview-one', name: 'Preview saved profile', model: 'Offline test model' }],
      sendRequest: async () => { throw new Error('Offline UI fixture: generation disabled'); },
    },
    generateRaw: async () => { throw new Error('Offline UI fixture: generation disabled'); },
  };
}
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Mochi OS — isolated UI test</title><link rel="stylesheet" href="/style.css"><style>
body{margin:0;background:#252525;color:#ddd;font-family:system-ui}#top-bar{height:40px;background:#1c1c1c;padding:0 12px;box-sizing:border-box;display:flex;align-items:center}#preview-status{padding:12px;font-size:14px}
</style></head><body><div id="top-bar">Offline Mochi OS test — no live API calls</div><div id="preview-status"></div><button id="reopen">Reopen preview</button><button id="test-saved">Test saved selection</button><button id="test-default">Test default selection</button><script type="module">
import { ready, openMochiOs } from '/app.js';
window.toastr={error:console.error,success:console.log,info:console.log};
await ready; openMochiOs(); document.querySelector('#reopen').onclick=openMochiOs;
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
</script></body></html>`;

http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
  if (url.pathname === '/scripts/st-context.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(context); return; }
  const file = { '/app.js': 'app.js', '/style.css': 'style.css' }[url.pathname];
  if (!file) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
  fs.createReadStream(path.join(root, file)).pipe(response);
}).listen(8127, '127.0.0.1', () => console.log('Isolated preview: http://127.0.0.1:8127'));
