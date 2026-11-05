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
const requests = [];
const failedDeletes = new Set();
let failedRoute;
let listedNames;
let uploadPathPrefix = '/';
const originalFetch = globalThis.fetch;
globalThis.FileReader = class {
  readAsDataURL(blob) { blob.arrayBuffer().then((bytes) => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); }); }
};
globalThis.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  requests.push({ url, body, options });
  if (url === failedRoute) return new Response('', { status: 500 });
  if (url === '/api/images/upload' || url === '/api/files/upload') {
    const path = url.includes('/images/') ? `user/images/${body.ch_name}/${body.filename}` : `user/files/${body.name}`;
    files.set(path, Buffer.from(body.image ?? body.data, 'base64'));
    return Response.json({ path: `${uploadPathPrefix}${path}` });
  }
  if (url === '/api/images/list') return Response.json(listedNames ?? [...files.keys()].filter((key) => key.startsWith(`user/images/${body.folder}/`)).map((key) => key.split('/').pop()));
  if (url.endsWith('/delete')) {
    if (failedDeletes.has(body.path)) return new Response('', { status: 500 });
    const existed = files.delete(body.path); return new Response('', { status: existed ? 200 : 404 });
  }
  const data = files.get(decodeURIComponent(url.slice(1)));
  return new Response(data ?? '', { status: data ? 200 : 404 });
};
try {
  const first = api.createNativeStickerStorage();
  assert.deepEqual(await first.read(), []);
  const blob = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
  const record = { id: 'native-test', fileName: 'native-test.png', name: 'Hello', mimeType: 'image/png', blob };
  const mutableRecords = await first.read();
  mutableRecords.push(record);
  await first.write(mutableRecords, ['receipt']);
  assert.ok(files.has('user/images/mochi-os-stickers/native-test.png'), 'appending to the read result must still upload new image bytes');
  const second = api.createNativeStickerStorage();
  assert.equal((await second.read())[0].name, 'Hello');
  assert.ok(second.hasMigration('receipt'));
  await first.write([{ ...record, name: 'Renamed', aliases: ['Hello'] }]);
  assert.equal(JSON.parse(files.get('user/files/mochi-os-stickers-library.json')).stickers[0].name, 'Renamed', 'rename accepts the leading-slash index path returned by SillyTavern');
  uploadPathPrefix = '';
  await assert.rejects(second.write([]), /another device/);
  assert.deepEqual((await second.read())[0].aliases, ['Hello']);
  files.delete('user/images/mochi-os-stickers/native-test.png');
  const recovery = api.createNativeStickerStorage();
  assert.deepEqual(await recovery.read(), [], 'missing images must not block loading');
  assert.match(recovery.warning, /sticker image\(s\) are missing/i);
  await recovery.write([{ ...record, id: 'replacement', fileName: 'replacement.png' }]);
  assert.equal((await api.createNativeStickerStorage().read()).length, 1, 'new stickers can be saved after an image goes missing');
  files.delete('user/images/mochi-os-stickers/replacement.png');
  const reset = api.createNativeStickerStorage();
  await reset.read();
  await reset.write([]);
  assert.deepEqual(await api.createNativeStickerStorage().read(), [], 'reset persists despite missing files');
  assert.ok(reset.hasMigration('receipt'), 'reset preserves migration receipts');
  files.set('user/images/mochi-os-stickers/orphan.png', Buffer.from('orphan'));
  files.set('user/images/another-extension/keep.png', Buffer.from('keep'));
  await api.deleteNativeStickers();
  assert.deepEqual([...files.keys()], ['user/images/another-extension/keep.png']);
  await api.deleteNativeStickers();

  const imagePath = 'user/images/mochi-os-stickers/';
  const indexPath = 'user/files/mochi-os-stickers-library.json';
  const bytes = Buffer.from(await blob.arrayBuffer());
  files.set(`${imagePath}Happy cat 🐈.PNG`, bytes);
  files.set(`${imagePath}party.png`, bytes);
  files.set(`${imagePath}not-an-image.png`, Buffer.from('not an image'));
  files.set(`${imagePath}ignore.svg`, Buffer.from('<svg/>'));
  const unindexed = api.createNativeStickerStorage();
  const recovered = await unindexed.read();
  assert.equal(recovered.length, 2, 'existing images load even when the name index is missing');
  assert.match(unindexed.warning, /Recovered 2/);
  assert.match(unindexed.warning, /invalid sticker/i);
  assert.equal(files.has(indexPath), false, 'loading does not silently replace or create an index');
  assert.deepEqual((await api.createNativeStickerStorage().read()).map(({ id }) => id), recovered.map(({ id }) => id), 'recovered ids are stable across reloads');
  const cat = recovered.find(({ name }) => name === 'happy_cat');
  assert.ok(cat && cat.fileName.endsWith('.png'));
  const uploadsBefore = requests.filter(({ url }) => url === '/api/images/upload').length;
  await unindexed.write(recovered.map((entry) => entry.id === cat.id ? { ...entry, name: 'Happy Cat', aliases: [entry.name] } : entry));
  assert.equal(requests.filter(({ url }) => url === '/api/images/upload').length, uploadsBefore, 'recovering and renaming reuse the original files instead of uploading duplicate images');
  const savedIndex = JSON.parse(files.get(indexPath));
  assert.equal(savedIndex.imageFiles[cat.fileName], 'Happy cat 🐈.PNG');
  assert.equal((await api.createNativeStickerStorage().read()).find(({ id }) => id === cat.id).name, 'Happy Cat', 'recovered names and encoded source paths survive reload');

  files.set(`${imagePath}restored.gif`, Buffer.from('GIF89a123456'));
  const stale = api.createNativeStickerStorage();
  const reconciled = await stale.read();
  assert.equal(reconciled.length, 3, 'a stale but valid index does not hide newly restored folder images');
  assert.equal(reconciled.find(({ id }) => id === cat.id).aliases[0], 'happy_cat', 'indexed names and aliases are preserved during folder recovery');
  failedDeletes.add(`${imagePath}party.png`);
  await stale.write(reconciled.filter(({ id }) => id !== 'party'));
  assert.ok(files.has(`${imagePath}party.png`), 'fixture simulates an image-delete failure');
  assert.match(stale.warning, /could not be deleted/);
  assert.equal((await api.createNativeStickerStorage().read()).some(({ id }) => id === 'party'), false, 'deliberately removed images never reappear after failed disk cleanup');
  assert.ok(JSON.parse(files.get(indexPath)).deletedFiles.includes('party.png'));
  failedDeletes.clear();

  files.set(indexPath, Buffer.from(JSON.stringify([{ id: 'party', fileName: 'party.png', name: 'Party', mimeType: 'image/png' }])));
  assert.equal((await api.createNativeStickerStorage().read()).find(({ id }) => id === 'party').name, 'Party', 'older array indexes remain readable');
  files.set(indexPath, Buffer.from('{broken index'));
  const invalidIndex = Buffer.from(files.get(indexPath));
  await assert.rejects(api.createNativeStickerStorage().read(), /invalid and was not replaced/);
  assert.deepEqual(files.get(indexPath), invalidIndex, 'an invalid index is never overwritten by recovery');

  listedNames = ['../outside.png'];
  files.delete(indexPath);
  await assert.rejects(api.createNativeStickerStorage().read(), /Invalid sticker file list/);
  assert.ok(!requests.some(({ url }) => url.includes('../outside')), 'folder reconciliation never follows paths supplied by a file list');
  listedNames = undefined;
  failedRoute = '/api/images/list';
  await assert.rejects(api.createNativeStickerStorage().read(), /500.*api\/images\/list/, 'folder permission failures are reported rather than pretending the library is empty');
  failedRoute = undefined;

  await api.deleteNativeStickers();
  assert.deepEqual([...files.keys()], ['user/images/another-extension/keep.png'], 'cleanup supports recovered Unicode filenames and stays inside the sticker folder');
  assert.ok(requests.every(({ options }) => options.credentials === 'same-origin' && options.cache === 'no-store'));
  console.log('PASS native stickers: persistence, aliases, stale saves, missing-index/folder recovery, Unicode files, invalid images, deletion tombstones, path safety, receipts, and scoped uninstall');
} finally { globalThis.fetch = originalFetch; }
