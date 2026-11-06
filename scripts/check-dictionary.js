'use strict';
// Looks up every word in words.js on Wiktionary and prints its short meaning.
// Uses the real internet, so it is not part of `npm test`.
// Words with their own `meaning` in words.js are shown as "own" and not looked up.
// Read the output: Wiktionary's first meaning can be the wrong sense for the game.
// Run with: npm run check:dictionary

const WORDS = require('../words');
const { createDictionary } = require('../dictionary');

async function main() {
  const dict = createDictionary({ enabled: true, timeoutMs: 8000 });
  const missing = [];
  for (const w of WORDS) {
    if (w.meaning) { console.log('  own   ' + w.word + ': ' + w.meaning); continue; }
    const m = await dict.lookup(w.word);
    if (m) console.log('  ok    ' + w.word + ': ' + m.text);
    else { missing.push(w.word); console.log('  NONE  ' + w.word); }
    await new Promise((r) => setTimeout(r, 150)); // be gentle with Wikimedia
  }
  console.log('\n' + (WORDS.length - missing.length) + ' of ' + WORDS.length + ' words have a meaning.');
  if (missing.length) console.log('No meaning found for: ' + missing.join(', '));
}

main();
