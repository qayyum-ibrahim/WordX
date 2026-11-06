'use strict';
// Tests the Wiktionary meaning lookup with a fake API (no internet needed).
// Run with: npm test

const assert = require('assert');
const WORDS = require('../words');
const { createDictionary, pickMeaning, cleanText, USER_AGENT } = require('../dictionary');

let passed = 0;
function ok(name) { passed++; console.log('  ok  ' + name); }

// A fake fetch. `pages` maps a term to a response body, a status number, or 'throw'/'hang'.
function fakeFetch(pages) {
  const calls = [];
  const fn = (url, opts) => {
    const term = decodeURIComponent(url.split('/').pop());
    calls.push({ term, opts });
    const page = pages[term];
    if (page === 'throw') return Promise.reject(new Error('network down'));
    if (page === 'hang') {
      return new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
      }));
    }
    const status = typeof page === 'number' ? page : page ? 200 : 404;
    return Promise.resolve({ status, ok: status === 200, json: async () => page });
  };
  fn.calls = calls;
  return fn;
}

const noun = (defs, language = 'English', partOfSpeech = 'Noun') => ({ language, partOfSpeech, definitions: defs.map((d) => ({ definition: d })) });

async function main() {
  // parsing
  assert.strictEqual(cleanText('A <a href="/wiki/x">big</a> &amp; <i>tall</i> animal.'), 'A big & tall animal.');
  assert.strictEqual(cleanText('Main sense.<ol><li>Sub sense.</li></ol>'), 'Main sense.');
  assert.strictEqual(cleanText('A <style>.x{color:red}</style>bird.'), 'A bird.');
  assert.strictEqual(cleanText('Someone that farms, as:'), 'Someone that farms');
  const long = cleanText('word '.repeat(80));
  assert(long.length <= 160 && long.endsWith('…'), 'long meanings are cut to 160 characters');
  ok('HTML stripped, sub-meanings dropped, long text cut');

  const data = {
    en: [
      noun(['ISO 639-3 language code for Yamba.'], 'Translingual', 'Symbol'),
      noun(['To laugh loudly.'], 'English', 'Verb'),
      noun(['Alternative form of yams.', 'A starchy root.'])
    ]
  };
  assert.strictEqual(pickMeaning(data), 'A starchy root.');
  assert.strictEqual(pickMeaning({ en: [noun(['Plural of thing.'])] }), 'Plural of thing.');
  assert.strictEqual(pickMeaning({}), null);
  assert.strictEqual(pickMeaning(null), null);
  ok('English nouns first; "form of" and non-English entries skipped');

  // lookup: lower case first, then capitalised; sends a User-Agent
  const f1 = fakeFetch({ lagos: 404, Lagos: { en: [noun(['A city in Nigeria.'])] } });
  const d1 = createDictionary({ enabled: true, fetch: f1 });
  const m1 = await d1.lookup('Lagos');
  assert.deepStrictEqual(m1, { text: 'A city in Nigeria.', url: 'https://en.wiktionary.org/wiki/Lagos' });
  assert.deepStrictEqual(f1.calls.map((c) => c.term), ['lagos', 'Lagos']);
  assert.strictEqual(f1.calls[0].opts.headers['User-Agent'], USER_AGENT);
  assert(/WordX/.test(USER_AGENT) && /https:\/\//.test(USER_AGENT), 'User-Agent names the app and a contact link');
  ok('tries lower case then capitalised; sends a WordX User-Agent');

  // cache: second call does not hit the API, get() is instant
  await d1.lookup('lagos');
  assert.strictEqual(f1.calls.length, 2);
  assert.strictEqual(d1.get('LAGOS').text, 'A city in Nigeria.');
  assert.strictEqual(d1.get('Abuja'), null);
  ok('meanings are cached');

  // own meaning in words.js wins and is not looked up
  const f2 = fakeFetch({ torch: { en: [noun(['A burning stick.'])] } });
  const d2 = createDictionary({ enabled: true, fetch: f2 });
  await d2.prefetch([{ word: 'Torch', meaning: 'A handheld light.' }]);
  assert.strictEqual(f2.calls.length, 0);
  assert.deepStrictEqual(d2.meaningFor({ word: 'Torch', meaning: 'A handheld light.' }), { text: 'A handheld light.', url: null });
  ok('a word\'s own meaning wins and skips the API');

  // fail safe: network error, server error, timeout, unknown word
  const now = { t: 1000 };
  const f3 = fakeFetch({ egg: 'throw', ant: 500, owl: 'hang' });
  const d3 = createDictionary({ enabled: true, fetch: f3, timeoutMs: 50, now: () => now.t });
  const errLog = console.error;
  console.error = () => {}; // the failures below are expected
  assert.strictEqual(await d3.lookup('egg'), null);
  assert.strictEqual(await d3.lookup('ant'), null);
  const t0 = Date.now();
  assert.strictEqual(await d3.lookup('owl'), null);
  assert(Date.now() - t0 < 1000, 'timeout must stop a slow request');
  assert.strictEqual(await d3.lookup('zzqxv'), null);
  await d3.prefetch([{ word: 'egg' }, { word: 'ant' }]);
  console.error = errLog;
  assert.strictEqual(d3.meaningFor({ word: 'egg' }), null);
  ok('API down, error, timeout or unknown word: returns null, never throws');

  const before = f3.calls.length;
  await d3.lookup('egg');
  assert.strictEqual(f3.calls.length, before, 'a failure is not retried straight away');
  now.t += 11 * 60 * 1000;
  f3.calls.length = 0;
  console.error = () => {};
  await d3.lookup('egg');
  console.error = errLog;
  assert.strictEqual(f3.calls.length, 1, 'a failure is retried after 10 minutes');
  ok('failed lookups wait 10 minutes before trying again');

  // turned off
  const f4 = fakeFetch({ egg: { en: [noun(['An egg.'])] } });
  const d4 = createDictionary({ enabled: false, fetch: f4 });
  assert.strictEqual(await d4.lookup('egg'), null);
  await d4.prefetch([{ word: 'egg' }]);
  assert.strictEqual(f4.calls.length, 0);
  ok('DICTIONARY=off makes no requests');

  // own meanings in words.js are short and clean
  for (const w of WORDS) {
    if (w.meaning === undefined) continue;
    assert(typeof w.meaning === 'string' && w.meaning.length >= 10 && w.meaning.length <= 160, w.word + ' meaning must be 10-160 characters');
    assert(!/[<>]/.test(w.meaning), w.word + ' meaning must be plain text');
  }
  ok('own meanings in words.js are plain text, 10-160 characters');

  console.log('\ndictionary: all ' + passed + ' checks passed');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
