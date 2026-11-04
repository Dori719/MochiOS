import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/st/sticker-native-storage.ts'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{
  name: 'host', setup(build) {
    build.onResolve({ filter: /^\.\/adapter$/ }, () => ({ path: 'host', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const ctx = () => ({getRequestHeaders: () => ({"Content-Type":"application/json"})});' }));
  },
}] });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const files = new Map();
const originalFetch = globalThis.fetch;
globalThis.FileReader = class {
  readAsDataURL(blob) { blob.arrayBuffer().then((bytes) => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); }); }
};
globalThis.fetch = async (url, options) => {
  const body = options.body ? JSON.parse(options.body) : null;
  if (url === '/api/images/upload' || url === '/api/files/upload') {
    const path = url.includes('/images/') ? `user/images/${body.ch_name}/${body.filename}` : `user/files/${body.name}`;
    files.set(path, Buffer.from(body.image ?? body.data, 'base64'));
    return Response.json({ path });
  }
  if (url === '/api/images/list') return Response.json([...files.keys()].filter((key) => key.startsWith(`user/images/${body.folder}/`)).map((key) => key.split('/').pop()));
  if (url.endsWith('/delete')) { const existed = files.delete(body.path); return new Response('', { status: existed ? 200 : 404 }); }
  const data = files.get(url.slice(1));
  return new Response(data ?? '', { status: data ? 200 : 404 });
};
try {
  const first = api.createNativeStickerStorage();
  assert.deepEqual(await first.read(), []);
  const blob = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
  const record = { id: 'native-test', fileName: 'native-test.png', name: 'Hello', mimeType: 'image/png', blob };
  await first.write([record], ['receipt']);
  const second = api.createNativeStickerStorage();
  assert.equal((await second.read())[0].name, 'Hello');
  assert.ok(second.hasMigration('receipt'));
  await first.write([{ ...record, name: 'Renamed', aliases: ['Hello'] }]);
  await assert.rejects(second.write([]), /another device/);
  assert.deepEqual((await second.read())[0].aliases, ['Hello']);
  files.set('user/images/mochi-os-stickers/orphan.png', Buffer.from('orphan'));
  files.set('user/images/another-extension/keep.png', Buffer.from('keep'));
  await api.deleteNativeStickers();
  assert.deepEqual([...files.keys()], ['user/images/another-extension/keep.png']);
  await api.deleteNativeStickers();
  console.log('PASS native sticker persistence, aliases, stale writes, receipts, and scoped uninstall cleanup');
} finally { globalThis.fetch = originalFetch; }
