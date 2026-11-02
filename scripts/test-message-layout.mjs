import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export async function runMessageLayoutTests() {
  const root = path.resolve(import.meta.dirname, '..');
  const cache = path.join(root, 'node_modules/.cache/mochi-os-tests');
  fs.mkdirSync(cache, { recursive: true });
  // Keep Node package resolution, but never leave generated test files behind
  // or overwrite another run's fixtures in this checked-in dependency tree.
  const directory = fs.mkdtempSync(path.join(cache, 'message-layout-'));
  const output = path.join(directory, 'suite.mjs');
  try {
    await buildMessageLayoutBundle(root, output);
    await checkMessageLayouts(root, output);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function buildMessageLayoutBundle(root, output) {
  await build({
    stdin: {
      contents: `
        export { MochiMessageLayout } from './src/components/chat/mochi-os/MochiMessageLayout';
        export { MochiBubbleMeta } from './src/components/chat/mochi-os/MochiBubbleMeta';
        export { MochiMessageActions } from './src/components/chat/mochi-os/MochiMessageActions';
        export { MochiWidgetMessageBubble } from './src/components/chat/mochi-os/MochiWidgetMessageBubble';
        export { alignMochiMessageLayout } from './src/components/chat/mochi-os/mochi-message-layout';
      `,
      resolveDir: root,
      loader: 'ts',
    },
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    alias: {
      '@marinara-engine/shared': path.join(root, 'src/shared/index.ts'),
      clsx: path.join(root, 'src/compat/clsx.ts'),
      'tailwind-merge': path.join(root, 'src/compat/tailwind-merge.ts'),
      'react-i18next': path.join(root, 'src/compat/react-i18next.ts'),
      i18next: path.join(root, 'src/compat/i18next.ts'),
    },
    logLevel: 'silent',
  });
}

async function checkMessageLayouts(root, output) {
  const { MochiMessageLayout, MochiBubbleMeta, MochiMessageActions, MochiWidgetMessageBubble, alignMochiMessageLayout } = await import(pathToFileURL(output).href);
  const types = ['text', 'voice', 'sticker', 'image', 'imgdesc', 'quote', 'link', 'recalled',
    'transfer', 'transfer-accepted', 'transfer-rejected', 'news', 'file', 'custom-note', 'editing', 'typing'];

  for (const embedded of [false, true]) {
    for (const outgoing of [false, true]) {
      for (const group of [false, true]) {
        for (const type of types) {
          const body = embedded
            ? h(MochiWidgetMessageBubble, { message: { me: outgoing ? 1 : 0, type, text: 'Payload', dur: '0:07', rawItem: { amount: 3, quote: { name: 'Quoted author', c: 'Quoted content' } } }, currency: 'USD', stickerMap: new Map() })
            : h('div', { className: type === 'sticker' ? 'sticker' : `b ${outgoing ? 'out' : 'in'}`, 'data-test-bubble': type }, 'Payload');
          const markup = renderToStaticMarkup(h(MochiMessageLayout, {
            embedded, outgoing, name: 'Jun', sender: group ? ' Jun ' : undefined,
            color: '#68966a', className: 'actions-visible', 'data-message-type': type,
            'data-msg-id': 'fixture', role: 'button', tabIndex: 0,
          }, body, h(MochiBubbleMeta, { embedded, time: '11:59 PM' }), !embedded && h(MochiMessageActions, { inert: true }, h('button', null, 'Reply'))));
          const label = `${embedded ? 'widget' : 'phone'} ${group ? 'group' : 'private'} ${outgoing ? 'outgoing' : 'incoming'} ${type}`;
          const contentAt = markup.indexOf('mochi-message-content');
          const bodyAt = markup.indexOf(embedded ? type.startsWith('transfer') ? 'class="mochi-private-transfer' : 'class="mochi-private-bubble' : 'data-test-bubble=');
          const footerAt = markup.indexOf(embedded ? 'class="mochi-private-time' : 'class="mochi-bubble-meta');
          const senderAt = markup.indexOf('class="mochi-msg-sender');
          assert.ok(contentAt < bodyAt && bodyAt < footerAt, `${label}: body precedes the timestamp in a shared frame`);
          if (group && !outgoing) {
            assert.ok(contentAt < senderAt && senderAt < bodyAt, `${label}: group sender is above every body type`);
            assert.match(markup, /title="Jun">Jun<\/span>/);
          } else assert.equal(senderAt, -1, `${label}: private and outgoing messages have no sender header`);
          const avatarAt = markup.indexOf(embedded ? 'class="mochi-private-mini-avatar' : 'class="mini"');
          assert.equal(avatarAt >= 0, !outgoing, `${label}: only incoming messages have a left avatar`);
          if (!outgoing) assert.ok(avatarAt < contentAt, `${label}: avatar is beside the content, not inside a bubble`);
          if (!embedded) {
            assert.ok(footerAt < markup.indexOf('class="msg-actions-trigger'), `${label}: actions follow the timestamp in DOM order`);
            assert.match(markup, /aria-label="Message actions" inert=""/);
          }
          assert.ok(markup.includes(`data-message-type="${type}"`) && markup.includes('data-msg-id="fixture"') && markup.includes('tabindex="0"'), `${label}: frame preserves action targeting and keyboard interaction attributes`);
          assert.ok(!markup.includes('margin-bottom'), `${label}: avatar has no bubble-height-dependent offset`);
        }
      }
    }
  }

  // Geometry is deliberately independent of bubble type. Compact outgoing
  // bodies may be narrower than controls; their timestamps remain anchored.
  const previousStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (element) => ({ columnGap: element.gap || '4px' });
  const style = () => {
    const values = new Map();
    return { getPropertyValue: (name) => values.get(name) || '', setProperty: (name, value) => values.set(name, value) };
  };
  const geometry = (type, outgoing, bubbleWidth = 20, timeWidth = 52) => {
    const state = { bubbleWidth, timeWidth, maxWidth: 400 };
    const classes = new Set();
    const rect = (left, width, height = 14) => ({ left, right: left + width, width, height });
    const wrapperWidth = () => Math.max(state.bubbleWidth, Math.min(state.maxWidth, parseFloat(actions.style.getPropertyValue('--mochi-actions-inline-size')) || 220));
    const bubbleLeft = () => outgoing ? wrapperWidth() - state.bubbleWidth : 0;
    const bubble = { type, offsetTop: 0, offsetHeight: 16, getBoundingClientRect: () => rect(bubbleLeft(), state.bubbleWidth, 16) };
    const time = { textContent: '11:59 PM', getBoundingClientRect: () => rect(bubbleLeft() + state.bubbleWidth - state.timeWidth, state.timeWidth) };
    const metadata = { querySelector: () => time, getBoundingClientRect: () => rect(bubbleLeft(), state.bubbleWidth) };
    const actions = {
      style: style(), children: Array.from({ length: 7 }, () => ({ offsetWidth: 28 })), gap: '4px',
      getBoundingClientRect: () => rect(0, Math.min(wrapperWidth(), parseFloat(actions.style.getPropertyValue(classes.has('mochi-actions-inline') ? '--mochi-actions-compact-inline-size' : '--mochi-actions-inline-size')) || 220)),
    };
    const message = {
      style: style(), getBoundingClientRect: () => rect(0, wrapperWidth()),
      classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
      querySelector: (selector) => selector.includes('msg-actions-trigger') ? actions : selector.includes('mochi-bubble-meta') ? metadata : bubble,
      parentElement: { querySelector: () => outgoing ? null : { offsetHeight: 28 } },
    };
    return { state, classes, bubble, time, metadata, actions, message };
  };
  try {
    for (const type of types) {
      for (const outgoing of [false, true]) {
        const { message, actions, classes } = geometry(type, outgoing);
        alignMochiMessageLayout(message);
        assert.equal(message.style.getPropertyValue('--mochi-bubble-inline-size'), '20px');
        assert.equal(message.style.getPropertyValue('--mochi-bubble-inline-offset'), outgoing ? '200px' : '0px');
        assert.equal(message.style.getPropertyValue('--mochi-bubble-meta-gap'), outgoing ? '3px' : '15px', 'Tiny stickers leave timestamps clear of top-aligned avatars');
        assert.equal(actions.style.getPropertyValue('--mochi-actions-inline-size'), '220px', `${type}: all seven controls have a reserved footprint`);
        assert.equal(actions.style.getPropertyValue('--mochi-actions-inline-offset'), '0px');
        assert.equal(classes.has('mochi-actions-inline'), false, 'Compact bubbles keep actions below their timestamp');

        const wide = geometry(type, outgoing, 280);
        alignMochiMessageLayout(wide.message);
        assert.equal(wide.classes.has('mochi-actions-inline'), true, `${type}: the complete row fits with 8px timestamp clearance`);
        assert.equal(wide.actions.style.getPropertyValue('--mochi-actions-compact-inline-size'), '220px');
        assert.equal(wide.message.style.getPropertyValue('--mochi-bubble-meta-block-size'), '14px', 'The timestamp height anchors the shared row');
        wide.state.timeWidth = 53;
        alignMochiMessageLayout(wide.message);
        assert.equal(wide.classes.has('mochi-actions-inline'), false, 'Even 1px less than the required clearance uses the fallback row');
        wide.state.timeWidth = 52;
        wide.state.bubbleWidth = 320;
        alignMochiMessageLayout(wide.message);
        assert.equal(wide.classes.has('mochi-actions-inline'), true, 'Resizing the bubble can restore a fully fitting row');
        wide.actions.children.push({ offsetWidth: 44 }, { offsetWidth: 28 });
        alignMochiMessageLayout(wide.message);
        assert.equal(wide.classes.has('mochi-actions-inline'), false, 'New/wider controls are all included in the fit check');
      }
    }
    const wrapped = geometry('text', false, 150);
    wrapped.state.maxWidth = 150;
    alignMochiMessageLayout(wrapped.message);
    assert.equal(wrapped.classes.has('mochi-actions-inline'), false, 'A wrapped row is never moved onto the timestamp');
    const noClock = geometry('text', false, 350);
    noClock.time.textContent = '';
    alignMochiMessageLayout(noClock.message);
    assert.equal(noClock.classes.has('mochi-actions-inline'), false, 'No shared row is inferred from an absent timestamp');
  } finally {
    if (previousStyle) globalThis.getComputedStyle = previousStyle;
    else delete globalThis.getComputedStyle;
  }

  for (const component of ['MochiOsView', 'MochiPrivateChatWidget', 'MochiGroupChatWidget']) {
    const source = fs.readFileSync(path.join(root, `src/components/chat/mochi-os/${component}.tsx`), 'utf8');
    assert.match(source, /<MochiMessageLayout/, `${component} must use the shared frame`);
    assert.doesNotMatch(source, /className=["`]wmsg|className=["`]mrow|<MochiBubbleMeta[^>]*sender=/, `${component} must not retain a message-type-specific frame or footer author`);
  }
  console.log('PASS: every message type shares phone/widget frames, group-only headers, timestamp/action order, keyboard targets, compact control footprints, top-avatar clearance and all-or-nothing timestamp/action alignment');
}
