/** Real disk persistence behind a fake, authenticated ST router; no live installation. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { createStickerFixture } from './sticker-fixture.mjs';
import { install, installStickerStorage } from './install.mjs';

const root = path.resolve(import.meta.dirname, '..');

export async function runStickerStorageTests(api) {
  const compiled = await build({ entryPoints: [path.join(root, 'server/sticker-storage.mjs')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20' });
  const plugin = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const temporaryRoot = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
  const temporary = await fs.mkdtemp(path.join(temporaryRoot, 'mochi-sticker-tests-'));
  const serverRoot = path.join(temporary, 'SillyTavern');
  const globalRoot = path.join(serverRoot, 'public/scripts/extensions/third-party');
  const extension = path.join(globalRoot, 'MochiOS');
  const userRoot = path.join(serverRoot, 'data/default-user/extensions');
  const user = { profile: { handle: 'default-user', admin: true }, directories: { extensions: userRoot } };
  const headers = () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'offline-preview' });
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const databaseDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const originalFetch = globalThis.fetch;
  const originalHeaders = globalThis.__mochiTestHost.getRequestHeaders;
  try {
    await fs.mkdir(extension, { recursive: true });
    await fs.mkdir(userRoot, { recursive: true });
    const extensionManifest = await fs.readFile(path.join(root, 'manifest.json'));
    await fs.writeFile(path.join(extension, 'manifest.json'), extensionManifest);
    const fixture = createStickerFixture(plugin, { serverRoot, user });
    const backend = () => api.createServerStickerStorage('MochiOS', fixture.fetch, headers);
    const urls = { createObjectURL: () => `blob:disk-${Math.random()}`, revokeObjectURL() {} };
    const firstBackend = backend();
    const first = api.createStickerLibrary(async () => firstBackend, urls);
    const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
    const png = new File([pngBytes], 'Local sticker.png', { type: 'image/png' });
    await first.load();
    assert.equal(first.getSnapshot().location, 'MochiOS/stickers');
    await assert.rejects(fs.stat(path.join(extension, 'stickers')), { code: 'ENOENT' }, 'Loading an empty library creates no files');
    await first.add([{ file: png, name: 'Local sticker' }]);
    const id = first.getSnapshot().list[0].id;
    const diskIndex = path.join(extension, 'stickers/.library.json');
    let disk = JSON.parse(await fs.readFile(diskIndex, 'utf8'));
    assert.equal(disk.version, 1);
    assert.equal(disk.stickers[0].name, 'Local sticker');
    assert.equal(disk.stickers[0].data, undefined, 'The disk index holds metadata, not a second base64 image copy');
    assert.deepEqual(await fs.readFile(path.join(extension, 'stickers', `.${disk.stickers[0].fileName}`)), pngBytes);
    assert.ok((await fs.readdir(path.join(extension, 'stickers'))).every((file) => file.startsWith('.')), 'Saved media and metadata are hidden from SillyTavern\'s public static handler');
    await first.rename(id, 'Renamed local sticker');
    const second = api.createStickerLibrary(async () => backend(), urls);
    await second.load();
    assert.equal(second.getSnapshot().list[0].name, 'Renamed local sticker', 'A different browser/session reads the same extension files');
    assert.deepEqual(second.getSnapshot().list[0].aliases, ['Local sticker']);
    assert.deepEqual((await api.readStickerBackup(await second.exportJson()))[0].aliases, ['Local sticker']);
    assert.ok(fixture.requests.every((request) => request.headers.get('X-CSRF-Token') === 'offline-preview'), 'All requests use the host request headers');
    assert.ok(fixture.requests.filter((request) => request.method === 'POST').every((request) => request.headers.get('Content-Type') === 'application/json'));
    assert.ok(fixture.requests.some((request) => request.method === 'POST' && request.body.stickers[0].data === undefined), 'Renaming does not re-upload the image');

    // Compare-and-swap retries merge distinct saves but still reject duplicate names.
    await Promise.all([first.add([{ file: png, name: 'First device' }]), second.add([{ file: png, name: 'Second device' }])]);
    disk = JSON.parse(await fs.readFile(diskIndex, 'utf8'));
    assert.equal(disk.stickers.length, 3, 'Concurrent devices cannot overwrite each other\'s imported images');
    const duplicate = await Promise.allSettled([first.add([{ file: png, name: 'Duplicate device name' }]), second.add([{ file: png, name: ' DUPLICATE DEVICE NAME ' }])]);
    assert.deepEqual(duplicate.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(JSON.parse(await fs.readFile(diskIndex, 'utf8')).stickers.length, 4);
    assert.ok(fixture.requests.some((request) => request.status === 409), 'Real stale writes are rejected by the server revision guard');
    const stale = backend();
    const oldRecords = await stale.read();
    await first.add([{ file: png, name: 'A newer save' }]);
    await assert.rejects(stale.write(oldRecords), /changed on another device/);

    const store = plugin.createDiskStickerStore(extension);
    const state = await store.read();
    const entry = (id, name, data = pngBytes, mimeType = 'image/png', extension = 'png') => ({ id, name, fileName: `${id}.${extension}`, mimeType, data: `data:${mimeType};base64,${data.toString('base64')}` });
    const rawSave = (stickers, extra = {}) => store.write({ revision: state.revision, stickers, migrations: [], ...extra });
    const invalid = [
      [entry('new-one', 'new'), entry('new-two', ' ＮＥＷ ')],
      [...state.stickers, entry('new-one', 'Local sticker')],
      [...state.stickers, { ...entry('new-one', 'Other'), aliases: ['LOCAL STICKER'] }],
      [...state.stickers, entry('../escape', 'Traversal')],
      [...state.stickers, entry('NUL', 'Windows device filename')],
      [...state.stickers, { ...entry('new-one', 'Traversal'), fileName: '../outside.png' }],
      [...state.stickers, entry('new-one', 'bad:name')],
      [...state.stickers, entry('new-one', '[Sticker] bad')],
      [...state.stickers, entry('new-one', 'Not an image', Buffer.from('<svg onload="bad()"/>'))],
      [...state.stickers, entry('new-one', 'Wrong MIME', pngBytes, 'image/jpeg', 'jpg')],
      [...state.stickers, { ...entry('new-one', 'Wrong extension'), fileName: 'new-one.jpg' }],
      [...state.stickers, { ...entry('new-one', 'Bad base64'), data: 'data:image/png;base64,!!!!' }],
      [...state.stickers, { ...entry('new-one', 'Missing data'), data: undefined }],
      [{ ...state.stickers[0], aliases: [] }, ...state.stickers.slice(1)],
      [{ ...state.stickers[0], data: `data:image/png;base64,${Buffer.concat([pngBytes, Buffer.from('changed')]).toString('base64')}` }, ...state.stickers.slice(1)],
      [{ ...state.stickers[0], id: state.stickers[0].id.toUpperCase(), fileName: state.stickers[0].fileName.toUpperCase().replace('.PNG', '.png') }, ...state.stickers.slice(1)],
    ];
    const beforeInvalid = await fs.readFile(diskIndex, 'utf8');
    const beforeFiles = (await fs.readdir(store.directory)).sort();
    for (const records of invalid) {
      await assert.rejects(rawSave(records));
      assert.equal(await fs.readFile(diskIndex, 'utf8'), beforeInvalid);
      assert.deepEqual((await fs.readdir(store.directory)).sort(), beforeFiles, 'Invalid batches create no files and replace nothing');
    }
    await assert.rejects(rawSave([...state.stickers, entry('oversized', 'Too large', Buffer.alloc(api.MAX_STICKER_BYTES + 1))]), /under 10 MB/);
    await assert.rejects(rawSave(state.stickers, { migrations: ['../unsafe'] }), /receipts are invalid/);
    const missingImage = path.join(store.directory, `.${state.stickers[0].fileName}`);
    await fs.unlink(missingImage);
    await assert.rejects(rawSave(state.stickers), /image is missing/);
    const missingLibrary = api.createStickerLibrary(async () => backend(), urls);
    await assert.rejects(missingLibrary.load(), /image is missing/);
    assert.equal(await fs.readFile(diskIndex, 'utf8'), beforeInvalid, 'A missing indexed image cannot silently replace the saved library');
    await fs.writeFile(missingImage, pngBytes);

    // An index commit failure rolls back only the newly written image and temp file.
    const failRename = new Proxy(fs, { get(target, key) { return key === 'rename' ? async () => { throw new Error('Disk full'); } : target[key]; } });
    const failingStore = plugin.createDiskStickerStore(extension, failRename);
    await assert.rejects(failingStore.write({ revision: state.revision, stickers: [...state.stickers, entry('rollback-image', 'Rollback image')] }), /Disk full/);
    assert.equal(await fs.readFile(diskIndex, 'utf8'), beforeInvalid);
    assert.deepEqual((await fs.readdir(store.directory)).sort(), beforeFiles);
    const failImageWrite = new Proxy(fs, { get(target, key) {
      if (key !== 'open') return target[key];
      return async (...args) => {
        const handle = await target.open(...args);
        if (!String(args[0]).endsWith('partial-image.png')) return handle;
        return { async writeFile(bytes) { await handle.writeFile(bytes.subarray(0, 8)); throw new Error('Image write failed'); }, sync: () => handle.sync(), close: () => handle.close() };
      };
    } });
    await assert.rejects(plugin.createDiskStickerStore(extension, failImageWrite).write({ revision: state.revision, stickers: [...state.stickers, entry('partial-image', 'Partial image')] }), /Image write failed/);
    assert.equal(await fs.readFile(diskIndex, 'utf8'), beforeInvalid);
    assert.deepEqual((await fs.readdir(store.directory)).sort(), beforeFiles, 'A partial image write is removed without disturbing the old pack');
    let unrelatedTemporary;
    const collideTemporary = new Proxy(fs, { get(target, key) {
      if (key !== 'open') return target[key];
      return async (...args) => {
        if (!String(args[0]).endsWith('.tmp')) return target.open(...args);
        unrelatedTemporary = args[0];
        await target.writeFile(unrelatedTemporary, 'An unrelated pre-existing file.');
        throw Object.assign(new Error('Temporary file already exists'), { code: 'EEXIST' });
      };
    } });
    await assert.rejects(plugin.createDiskStickerStore(extension, collideTemporary).write({ revision: state.revision, stickers: [...state.stickers, entry('temp-collision-image', 'Temporary collision image')] }), /already exists/);
    assert.equal(await fs.readFile(unrelatedTemporary, 'utf8'), 'An unrelated pre-existing file.', 'Rollback cannot delete a temporary file it did not create');
    await fs.unlink(unrelatedTemporary);
    assert.deepEqual((await fs.readdir(store.directory)).sort(), beforeFiles);
    // Restarting the server/store needs neither object URLs nor a browser database.
    assert.deepEqual((await plugin.createDiskStickerStore(extension).read()).stickers, state.stickers);
    await fs.writeFile(diskIndex, '{broken index');
    await assert.rejects(store.read(), /invalid and was not replaced/);
    await assert.rejects(rawSave([]), /invalid and was not replaced/);
    assert.equal(await fs.readFile(diskIndex, 'utf8'), '{broken index');
    await fs.writeFile(diskIndex, beforeInvalid);

    if (process.platform === 'win32') {
      const current = await store.read();
      const aliasStore = plugin.createDiskStickerStore(extension.toUpperCase());
      const saves = await Promise.allSettled([
        store.write({ revision: current.revision, stickers: [...current.stickers, entry('case-folder-one', 'Case folder one')] }),
        aliasStore.write({ revision: current.revision, stickers: [...current.stickers, entry('case-folder-two', 'Case folder two')] }),
      ]);
      assert.deepEqual(saves.map((result) => result.status).sort(), ['fulfilled', 'rejected'], 'Windows path casing must not bypass the folder write lock');
      assert.equal((await store.read()).stickers.length, current.stickers.length + 1);
    }

    // Migration merges only identical image/name overlaps, preserving legacy aliases.
    const old = { id: 'legacy-image', name: 'Browser sticker', aliases: ['Old browser name'], fileName: 'legacy-image.png', mimeType: 'image/png', blob: png };
    const legacy = [{ source: 'opfs', records: [old] }];
    const migrationBackend = backend();
    await api.migrateBrowserStickerPacks(migrationBackend, legacy);
    let migrated = await migrationBackend.read();
    assert.ok(migrated.some((record) => record.id === old.id && record.aliases.includes('Old browser name')));
    assert.ok(migrationBackend.hasMigration('opfs:legacy-image'));
    const otherBrowser = { ...old, id: 'another-browser-image', fileName: 'another-browser-image.png', name: 'BROWSER STICKER' };
    await api.migrateBrowserStickerPacks(migrationBackend, [{ source: 'indexeddb', records: [otherBrowser] }]);
    migrated = await migrationBackend.read();
    assert.equal(migrated.filter((record) => api.stickerNameKey(record.name) === 'browser sticker').length, 1);
    assert.ok(migrated.find((record) => record.id === old.id).aliases.includes('BROWSER STICKER'));
    const beforeConflict = await fs.readFile(diskIndex, 'utf8');
    const different = { ...old, id: 'conflicting-browser-image', fileName: 'conflicting-browser-image.png', blob: new Blob([pngBytes, 'different'], { type: 'image/png' }) };
    await assert.rejects(api.migrateBrowserStickerPacks(migrationBackend, [{ source: 'opfs', records: [different] }]), /conflicts/);
    assert.equal(await fs.readFile(diskIndex, 'utf8'), beforeConflict, 'A conflicting migration writes neither images nor receipts');
    const migratedLibrary = api.createStickerLibrary(async () => migrationBackend, urls);
    await migratedLibrary.remove(old.id);
    await api.migrateBrowserStickerPacks(backend(), legacy);
    assert.ok(!(await backend().read()).some((record) => record.id === old.id), 'Deleted migrated images are not resurrected by the untouched recovery copy');
    assert.equal(old.name, 'Browser sticker', 'Migration never changes the browser recovery pack');

    // The plugin respects ST login, global-admin policy, and the actual folder name.
    const endpoint = '/api/plugins/mochi-os-stickers/library?extension=MochiOS';
    assert.equal((await fixture.fetch(endpoint, {}, null)).status, 403);
    const nonAdmin = { ...user, profile: { ...user.profile, admin: false } };
    assert.equal((await fixture.fetch(endpoint, {}, nonAdmin)).status, 200);
    assert.equal((await fixture.fetch(endpoint, { method: 'POST', headers: headers(), body: JSON.stringify({ revision: null, stickers: [] }) }, nonAdmin)).status, 403);
    assert.equal((await fixture.fetch(endpoint, { method: 'POST', body: '{}' })).status, 403, 'Host CSRF guard applies to writes');
    for (const name of ['..', '../MochiOS', 'MochiOS/../../outside', 'C:\\outside', 'MochiOS.']) {
      assert.equal((await fixture.fetch(`/api/plugins/mochi-os-stickers/library?extension=${encodeURIComponent(name)}`)).status, 400);
    }
    const unrelated = path.join(globalRoot, 'OtherExtension');
    await fs.mkdir(unrelated);
    await fs.writeFile(path.join(unrelated, 'manifest.json'), JSON.stringify({ display_name: 'Other Extension', js: 'index.js' }));
    assert.equal((await fixture.fetch('/api/plugins/mochi-os-stickers/library?extension=OtherExtension')).status, 400);
    await assert.rejects(fs.stat(path.join(unrelated, 'stickers')), { code: 'ENOENT' });
    const personal = path.join(userRoot, 'My Mochi');
    await fs.mkdir(personal);
    await fs.writeFile(path.join(personal, 'manifest.json'), extensionManifest);
    const personalResponse = await fixture.fetch('/api/plugins/mochi-os-stickers/library?extension=My%20Mochi', { method: 'POST', headers: headers(), body: JSON.stringify({ revision: null, stickers: [entry('personal-image', 'Personal sticker')] }) }, nonAdmin);
    assert.equal(personalResponse.status, 200);
    assert.ok(await fs.stat(path.join(personal, 'stickers/.personal-image.png')));
    const outside = path.join(temporary, 'outside');
    const linked = path.join(globalRoot, 'LinkedMochi');
    await fs.mkdir(outside);
    await fs.mkdir(linked);
    await fs.writeFile(path.join(linked, 'manifest.json'), extensionManifest);
    await fs.symlink(outside, path.join(linked, 'stickers'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await fixture.fetch('/api/plugins/mochi-os-stickers/library?extension=LinkedMochi')).status, 403);
    assert.deepEqual(await fs.readdir(outside), []);

    // Legacy APIs are read-only. New libraries must not create browser folders/databases.
    let legacyReads = 0;
    const noCreate = (options) => assert.ok(!options?.create, 'Legacy migration must never create browser files');
    const missingFile = () => { throw new DOMException('Not found', 'NotFoundError'); };
    let browserRecords = [old];
    const folder = {
      async getFileHandle(name, options) {
        noCreate(options); legacyReads++;
        if (name === 'library.json') return { getFile: async () => new Blob([JSON.stringify(browserRecords.map(({ blob: _blob, ...entry }) => entry))]) };
        const record = browserRecords.find((entry) => entry.fileName === name);
        return record ? { getFile: async () => record.blob } : missingFile();
      },
    };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { async getDirectory() { return { async getDirectoryHandle(name, options) { noCreate(options); assert.equal(name, 'mochi-os'); return { async getDirectoryHandle(name, options) { noCreate(options); assert.equal(name, 'stickers'); return folder; } }; } }; } } } });
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { databases: async () => [], open() { throw new Error('A missing legacy database must not be created'); } } });
    assert.equal((await api.readBrowserStickerPacks())[0].records[0].name, old.name);
    assert.equal((await api.readStickerBackup(await api.exportBrowserStickersJson()))[0].name, old.name);
    let databaseClosed = false;
    const databaseRecords = [different];
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
      databases: async () => [{ name: 'mochi-os-stickers', version: 1 }],
      open() {
        const request = {};
        request.result = { objectStoreNames: { contains: () => true }, close() { databaseClosed = true; }, transaction(_store, mode) {
          assert.equal(mode, 'readonly');
          const transaction = { objectStore: () => ({ getAll: () => {
            queueMicrotask(() => transaction.oncomplete()); return { result: databaseRecords };
          } }) };
          return transaction;
        } };
        queueMicrotask(() => request.onsuccess()); return request;
      },
    } });
    assert.deepEqual((await api.readBrowserStickerPacks()).map((pack) => pack.source), ['opfs', 'indexeddb']);
    assert.ok(databaseClosed, 'Read-only IndexedDB migration closes its connection');
    const recovery = await api.readStickerBackup(await api.exportBrowserStickersJson());
    assert.equal(recovery.length, 2, 'A recovery JSON includes conflicting browser packs so their names can be reviewed');
    assert.notEqual(recovery[0].file.size, recovery[1].file.size, 'Conflicting images keep their original bytes in the recovery backup');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
      open() {
        const request = { transaction: { abort() { queueMicrotask(() => request.onerror()); } } };
        queueMicrotask(() => request.onupgradeneeded()); return request;
      },
    } });
    assert.equal((await api.readBrowserStickerPacks()).length, 1, 'An absent legacy database is not created on older browsers without databases()');
    let lateDatabaseClosed = false;
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
      open() {
        const request = { result: { close() { lateDatabaseClosed = true; } } };
        queueMicrotask(() => { request.onblocked(); request.onsuccess(); }); return request;
      },
    } });
    await assert.rejects(api.readBrowserStickerPacks(), /Close older Mochi tabs/);
    assert.ok(lateDatabaseClosed, 'A blocked legacy open cannot leak a connection when it eventually succeeds');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { databases: async () => [], open() { throw new Error('Do not create browser storage'); } } });
    globalThis.__mochiTestHost.getRequestHeaders = headers;
    globalThis.fetch = (input, options) => fixture.fetch(String(input).replace('extension=mochi-os', 'extension=MochiOS'), options);
    browserRecords = [different];
    // Recreate its colliding disk name to exercise the nonblocking migration warning.
    await first.add([{ file: png, name: 'Browser sticker' }]);
    const warned = await api.extensionStickerStorage();
    assert.match(warned.warning, /conflicts.*original browser library is untouched/i);
    assert.ok((await warned.read()).length > 0, 'A migration warning does not hide or disable the disk library');
    const readCount = legacyReads;
    globalThis.fetch = async () => new Response(null, { status: 404 });
    const unavailable = api.createStickerLibrary(() => api.extensionStickerStorage(), urls);
    await assert.rejects(unavailable.load(), (error) => {
      assert.match(error.message, /Install the Mochi OS sticker server plugin/);
      assert.match(error.message, /plugins\/mochi-os-stickers\.mjs/);
      assert.match(error.message, /running SillyTavern installation/);
      assert.match(error.message, /setting alone does not install the plugin/);
      return true;
    });
    assert.equal(unavailable.getSnapshot().loaded, false);
    assert.deepEqual(unavailable.getSnapshot().list, []);
    assert.equal(legacyReads, readCount, 'Missing server storage does not fall back to the browser');
    globalThis.fetch = (input, options) => fixture.fetch(String(input).replace('extension=mochi-os', 'extension=MochiOS'), options);
    browserRecords = [];
    await unavailable.add([{ file: png, name: 'Saved after plugin repair' }]);
    assert.equal(unavailable.getSnapshot().loaded, true, 'The same library can save after its missing server plugin is installed');
    assert.equal(unavailable.getSnapshot().error, null);
    const repairedSticker = unavailable.getSnapshot().list.find((sticker) => sticker.name === 'Saved after plugin repair');
    assert.ok(repairedSticker);
    await unavailable.remove(repairedSticker.id);
    assert.equal(api.stickerExtensionFolder('http://localhost/scripts/extensions/third-party/My%20Mochi/app.js?v=2'), 'My Mochi');

    // Updating runtime files preserves in-folder stickers and installed checkouts.
    const oldGit = path.join(extension, '.git');
    const oldSource = path.join(extension, 'src');
    await fs.mkdir(oldGit); await fs.mkdir(oldSource);
    await fs.writeFile(path.join(oldGit, 'HEAD'), 'ref: refs/heads/local-work\n');
    await fs.writeFile(path.join(oldSource, 'user.ts'), '// Keep this local source work.\n');
    await fs.writeFile(path.join(serverRoot, 'config.yaml'), 'enableServerPlugins: false\n# User configuration\n');
    const finalIndex = await fs.readFile(diskIndex, 'utf8');
    await fs.writeFile(path.join(unrelated, 'index.js'), '// Keep another extension untouched.\n');
    assert.throws(() => install(serverRoot, { folder: 'OtherExtension' }), /not a Mochi OS extension/);
    assert.equal(await fs.readFile(path.join(unrelated, 'index.js'), 'utf8'), '// Keep another extension untouched.\n');
    assert.throws(() => install(serverRoot), /Several Mochi OS installations/, 'Ambiguous installations must be selected explicitly');
    await fs.rm(linked, { recursive: true, force: true });
    assert.equal(install(serverRoot), extension, 'Installer reuses the existing MochiOS folder rather than making a second extension');
    assert.equal(await fs.readFile(diskIndex, 'utf8'), finalIndex);
    assert.equal(await fs.readFile(path.join(oldGit, 'HEAD'), 'utf8'), 'ref: refs/heads/local-work\n');
    assert.equal(await fs.readFile(path.join(oldSource, 'user.ts'), 'utf8'), '// Keep this local source work.\n');
    await assert.rejects(fs.stat(path.join(globalRoot, 'mochi-os')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(serverRoot, 'plugins')), { code: 'ENOENT' }, 'Installing server code is opt-in');
    const localRuntime = '// Keep locally edited browser runtime during a backend repair.\n';
    await fs.writeFile(path.join(extension, 'app.js'), localRuntime);
    const installedPlugin = installStickerStorage(serverRoot);
    assert.equal(installedPlugin, path.join(serverRoot, 'plugins/mochi-os-stickers.mjs'));
    const repairOutput = execFileSync(process.execPath, [path.join(root, 'scripts/install.mjs'), '--target', serverRoot, '--sticker-storage-only'], { encoding: 'utf8' });
    assert.ok(repairOutput.includes(installedPlugin), 'The repair command reports the exact server plugin path');
    assert.match(repairOutput, /active config.yaml and fully restart SillyTavern/);
    assert.equal(await fs.readFile(path.join(extension, 'app.js'), 'utf8'), localRuntime, 'Plugin-only repair never replaces local browser runtime edits');
    assert.equal(await fs.readFile(diskIndex, 'utf8'), finalIndex);
    assert.equal(await fs.readFile(path.join(oldGit, 'HEAD'), 'utf8'), 'ref: refs/heads/local-work\n');
    assert.equal(await fs.readFile(path.join(oldSource, 'user.ts'), 'utf8'), '// Keep this local source work.\n');
    assert.equal(await fs.readFile(path.join(serverRoot, 'config.yaml'), 'utf8'), 'enableServerPlugins: false\n# User configuration\n');
    install(serverRoot, { withStickerStorage: true });
    assert.equal(await fs.readFile(path.join(serverRoot, 'plugins/mochi-os-stickers.mjs'), 'utf8'), await fs.readFile(path.join(root, 'sticker-storage.mjs'), 'utf8'));
    assert.equal(await fs.readFile(path.join(serverRoot, 'config.yaml'), 'utf8'), 'enableServerPlugins: false\n# User configuration\n');
    console.log('PASS: extension-folder image files and index, cross-device persistence/concurrency, shared server validation, immutable images and aliases, disk-full rollback, corrupt-index protection, one-time browser migration/recovery, login/CSRF/path/admin guards, missing-plugin recovery, and non-destructive runtime/plugin-only installer updates');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__mochiTestHost.getRequestHeaders = originalHeaders;
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
    if (databaseDescriptor) Object.defineProperty(globalThis, 'indexedDB', databaseDescriptor); else delete globalThis.indexedDB;
    await plugin.exit();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
