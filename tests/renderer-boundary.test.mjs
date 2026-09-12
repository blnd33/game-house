// Guards for the player UI's authority boundary (brief §2, §6, §9): no pricing
// policy, no direct network access, and development code reachable only
// through the single lazy import that Phase 5 packaging will remove.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../apps/desktop/src/', import.meta.url));

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(e => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}
const player = async () => {
  const all = await files(src);
  const code = all.filter(f => /\.(ts|tsx)$/.test(f) && !relative(src, f).startsWith('dev'));
  return Promise.all(code.map(async f => ({ file: relative(src, f), text: await readFile(f, 'utf8') })));
};

test('player code has no backend pricing or delay policy', async () => {
  for (const { file, text } of await player()) {
    assert.doesNotMatch(text, /billing_start_delay|hourly_rate|rate_decimal|minimum_charge|rounding_mode|billing_unit/, file);
  }
});

test('player code makes no direct network requests', async () => {
  for (const { file, text } of await player()) {
    assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|new WebSocket|EventSource/, file);
  }
});

test('development sample is reachable only through connect.ts', async () => {
  for (const { file, text } of await player()) {
    const importsDev = /from ['"][^'"]*\/dev\/|import\(['"][^'"]*\/dev\//.test(text.replace(/import type[^;]+;/g, ''));
    assert.equal(importsDev, file === join('station', 'connect.ts'), file);
  }
});
