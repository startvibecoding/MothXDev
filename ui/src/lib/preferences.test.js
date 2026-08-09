import test from 'node:test';
import assert from 'node:assert/strict';

import zh from './preferences/locales/zh.js';
import en from './preferences/locales/en.js';

function placeholders(value) {
  return [...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort();
}

test('locale dictionaries expose the same keys', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});

test('locale templates expose the same placeholders', () => {
  for (const key of Object.keys(zh)) {
    assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), key);
  }
});
