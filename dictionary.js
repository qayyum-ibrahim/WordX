'use strict';
// Short word meanings from Wiktionary, shown after each round.
// Fail safe: lookups never throw. If Wiktionary is slow or down, get() returns null
// and the game carries on without a meaning.
//
// Source: Wiktionary REST API, page/definition/{term}. Wikimedia marks this endpoint
// "experimental", so it may change. Text is CC BY-SA, so the UI credits Wiktionary
// and links to the entry.

const API = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
const PAGE = 'https://en.wiktionary.org/wiki/';
// Wikimedia asks for a descriptive User-Agent with contact info. Generic agents get a 403.
const USER_AGENT = 'WordXBot/1.0 (https://github.com/qayyum-ibrahim/WordX)';
const MAX_LEN = 160;
const RETRY_MS = 10 * 60 * 1000; // after a failure, wait before asking again

// "Plural of x", "Alternative spelling of x" and similar point to another entry. Use them only as a last resort.
const FORM_OF = /^(alternative|obsolete|archaic|dated|plural|ellipsis|abbreviation|clipping|short|initialism|misspelling|eye dialect|nonstandard|synonym|pronunciation spelling|present participle)\b.*\bof\b/i;

function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function cleanText(html) {
  let s = String(html || '');
  s = s.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(ol|ul|dl)[\s>][\s\S]*$/i, ''); // drop nested sub-meanings
  s = s.replace(/<[^>]+>/g, '');
  s = decode(s).replace(/\s+/g, ' ').trim();
  s = s.replace(/,?\s*as:$/, '').replace(/:$/, ''); // "Someone that farms, as:" introduces a sub-list
  if (s.length > MAX_LEN) {
    const cut = s.slice(0, MAX_LEN - 1);
    s = cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : cut.length).replace(/[,;:\s]+$/, '') + '…';
  }
  return s;
}

// Picks the first useful English definition from a Wiktionary response, nouns first
// (every game word is a thing). Returns text or null.
function pickMeaning(data) {
  const english = (data && Array.isArray(data.en) ? data.en : []).filter((e) => e && e.language === 'English');
  const isNoun = (e) => /noun/i.test(e.partOfSpeech || '');
  const entries = english.filter(isNoun).concat(english.filter((e) => !isNoun(e)));
  let fallback = null;
  for (const e of entries) {
    for (const d of Array.isArray(e.definitions) ? e.definitions : []) {
      const text = cleanText(d && d.definition);
      if (text.length < 3) continue;
      if (!FORM_OF.test(text)) return text;
      if (!fallback) fallback = text;
    }
  }
  return fallback;
}

function createDictionary(opts = {}) {
  const enabled = opts.enabled !== undefined ? opts.enabled : process.env.DICTIONARY !== 'off';
  const fetchFn = opts.fetch || globalThis.fetch;
  const timeoutMs = opts.timeoutMs || 4000;
  const now = opts.now || Date.now;
  const cache = new Map(); // word -> { meaning: {text, url} | null, at, failed }
  const pending = new Map(); // word -> Promise

  // Returns 'missing' for a clean "not found", or throws for network/server errors.
  async function fetchTerm(term) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(API + encodeURIComponent(term), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: ctrl.signal
      });
      if (res.status === 404) return 'missing';
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = pickMeaning(await res.json());
      return text ? { text, url: PAGE + encodeURIComponent(term) } : 'missing';
    } finally {
      clearTimeout(t);
    }
  }

  // Common nouns are lower case on Wiktionary; places like Lagos are capitalised. Try both.
  async function lookupFresh(word) {
    const lower = word.toLowerCase();
    const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
    const terms = [...new Set([lower, cap, word])];
    for (const term of terms) {
      const out = await fetchTerm(term);
      if (out !== 'missing') return out;
    }
    return null;
  }

  // Looks up a word and caches it. Always resolves, never rejects.
  function lookup(word) {
    const key = String(word || '').trim();
    if (!enabled || !key || !fetchFn) return Promise.resolve(null);
    const hit = cache.get(key.toLowerCase());
    if (hit && !(hit.failed && now() - hit.at > RETRY_MS)) return Promise.resolve(hit.meaning);
    if (pending.has(key.toLowerCase())) return pending.get(key.toLowerCase());
    const p = lookupFresh(key)
      .then((meaning) => {
        cache.set(key.toLowerCase(), { meaning, at: now(), failed: false });
        return meaning;
      })
      .catch((e) => {
        cache.set(key.toLowerCase(), { meaning: null, at: now(), failed: true });
        console.error('dictionary lookup failed for a word:', e.name === 'AbortError' ? 'timeout' : e.message);
        return null;
      })
      .finally(() => pending.delete(key.toLowerCase()));
    pending.set(key.toLowerCase(), p);
    return p;
  }

  // Cached meaning only, no waiting. Returns {text, url} or null.
  function get(word) {
    const hit = cache.get(String(word || '').trim().toLowerCase());
    return hit ? hit.meaning : null;
  }

  // Meaning for a word from words.js: its own `meaning` wins, then the Wiktionary cache.
  // Returns {text, url} or null. url is null for our own meanings (nothing to credit).
  function meaningFor(entry) {
    if (!entry) return null;
    if (entry.meaning) return { text: entry.meaning, url: null };
    return get(entry.word);
  }

  // Starts lookups in the background, one at a time, so a game start never waits on them.
  function prefetch(entries) {
    if (!enabled) return Promise.resolve();
    return entries
      .filter((e) => e && !e.meaning)
      .reduce((chain, e) => chain.then(() => lookup(e.word)), Promise.resolve());
  }

  return { lookup, get, meaningFor, prefetch, enabled };
}

module.exports = { createDictionary, pickMeaning, cleanText, USER_AGENT };
