import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { Store } from '../src/store.js';
import { dispatch } from '../src/service.js';
test('human workspace creates a source, cites it, edits a locator, changes style and removes it', async () => {
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), {
      url: 'http://localhost:3210',
    }),
    store = new Store(':memory:');
  store.create('UI manuscript');
  const oldFetch = globalThis.fetch;
  globalThis.document = dom.window.document;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.prompt = () => null;
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  globalThis.fetch = async (url, options) => {
    if (url === '/api/session') return { ok: true, json: async () => ({ token: 'test' }) };
    const { method, args } = JSON.parse(options.body);
    try {
      return { ok: true, json: async () => ({ result: await dispatch(store, method, args) }) };
    } catch (e) {
      return { ok: false, json: async () => ({ error: e.message }) };
    }
  };
  const $ = (s) => document.querySelector(s),
    event = { preventDefault() {} };
  try {
    await import('../public/app.js');
    assert.equal($('#title').textContent, 'UI manuscript');
    await $('#manual').onclick(event);
    for (const [key, value] of Object.entries({
      title: 'Human entered source',
      author: 'Smith, Jane',
      year: '2024',
      'container-title': 'Research Journal',
    }))
      $('[data-field="' + key + '"]').value = value;
    await $('#save-json').onclick(event);
    assert.equal($('#source-count').textContent, '1');
    assert.match($('#sources').textContent, /Human entered source/);
    await $('#sources button').onclick(event);
    assert.equal($('#citation-count').textContent, '1');
    assert.match($('#bibliography').textContent, /Human entered source/);
    $('#tab-citations').onclick();
    await [...$('#citations').querySelectorAll('button')]
      .find((b) => b.textContent === 'Edit group / pages')
      .onclick(event);
    $('[data-locator]').value = '15';
    await $('#save-json').onclick(event);
    $('#style').value = 'apa';
    await $('#style').onchange(event);
    assert.match($('#citations').textContent, /p\. 15/);
    await [...$('#citations').querySelectorAll('button')]
      .find((b) => b.textContent === 'Remove')
      .onclick(event);
    assert.equal($('#citation-count').textContent, '0');
    assert.equal($('#bibliography').textContent, '');
    assert.equal($('#source-count').textContent, '1');
  } finally {
    globalThis.fetch = oldFetch;
    delete globalThis.document;
    delete globalThis.sessionStorage;
    delete globalThis.prompt;
    store.close();
    dom.window.close();
  }
});
