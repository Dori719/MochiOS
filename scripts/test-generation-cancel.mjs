import { build } from 'esbuild';
import assert from 'node:assert/strict';

const fixture = { stops: 0, reject: null, started: null, signal: null };
globalThis.__cancelFixture = fixture;
const compiled = await build({ entryPoints: ['src/st/generate.ts'], bundle: true, platform: 'browser', format: 'esm', write: false,
  plugins: [{ name: 'cancel-host', setup(build) {
    build.onResolve({ filter: /^\.\/(adapter|connections|context-budget)$/ }, args => ({ path: args.path, namespace: 'cancel-host' }));
    build.onLoad({ filter: /.*/, namespace: 'cancel-host' }, args => ({ loader: 'js', contents: args.path === './adapter'
      ? `const f = globalThis.__cancelFixture; export const activeChatId = () => 'chat'; export const ctx = () => ({stopGeneration() { f.stops++; f.reject(new Error('stopped')); }}); export const st = () => ({ generateRaw() { return new Promise((resolve, reject) => { f.reject = reject; f.started(); }); } });`
      : args.path === './connections'
        ? `export const selectedConnectionProfileId = () => null; export const profileRequestService = async () => ({ sendRequest(id, messages, length, options) { const f = globalThis.__cancelFixture; f.signal = options.signal; return new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('stopped')), {once:true}); f.started(); }); } });`
        : `export const getMochiTokenLimits = () => ({api:'openai',responseLength:100}); export const fitMochiPromptToContext = async messages => messages;` }));
  } }],
});
const { generateMochiOutput } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
for (const profileId of [null, 'saved']) {
  const controller = new AbortController();
  const started = new Promise(resolve => { fixture.started = resolve; });
  const request = generateMochiOutput([{role:'user',content:'Forum'}], { chatId:'chat',profileId,signal:controller.signal });
  const rejected = assert.rejects(request, { name: 'AbortedError' });
  await started;
  controller.abort();
  await rejected;
}
assert.equal(fixture.stops, 1);
assert.equal(fixture.signal.aborted, true);
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(generateMochiOutput([], { signal: cancelled.signal }), { name: 'AbortedError' });
assert.equal(fixture.stops, 1);
delete globalThis.__cancelFixture;
console.log('PASS: cancellation stops native generation, aborts saved-profile requests, and rejects pre-cancelled requests.');
