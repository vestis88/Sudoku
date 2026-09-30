const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal localStorage for the module's offline cache.
const storage = {};
global.localStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => (storage[k] = String(v)),
};
const Leaderboard = require('../js/leaderboard.js');

function reset() {
  for (const k of Object.keys(storage)) delete storage[k];
}

function result(player, mode, level, timeMs, hints = 0, date = '2026-01-01T10:00:00.000Z') {
  return { id: `${player}-${timeMs}`, player, mode, level, timeMs, hints, date };
}

test('stats counts all games but lists only the fastest games without hints', () => {
  const s = Leaderboard.stats([
    result('Bim', 'mini', 'easy', 90000),
    result('Wille', 'mini', 'easy', 60000, 2),
    result('Bim', 'mini', 'easy', 75000),
    result('Johan', 'mini', 'easy', 120000),
    result('Frans', 'mini', 'easy', 200000),
    result('Johan', 'classic', 'hard', 900000),
    result('Nobody', 'mini', 'easy', 1000), // unknown player is ignored
  ]);
  const easy = s.mini.easy;
  assert.equal(easy.count, 5);
  assert.deepEqual(easy.byPlayer, { Wille: 1, Johan: 1, Bim: 2, Frans: 1 });
  // Wille's 60000 used hints: counted as played, but not on the leaderboard.
  assert.deepEqual(
    easy.best.map((r) => r.timeMs),
    [75000, 90000, 120000]
  );
  assert.equal(s.classic.hard.count, 1);
  assert.equal(s.mini.hard.count, 0);
  assert.deepEqual(s.mini.hard.best, []);
});

test('Firestore document round trip', () => {
  const r = result('Frans', 'classic', 'medium', 123456, 1);
  const doc = Leaderboard.toDoc(r);
  doc.name = 'projects/p/databases/(default)/documents/results/' + r.id;
  assert.deepEqual(Leaderboard.fromDoc(doc), r);
});

test('local-only mode keeps results on this device', async () => {
  reset();
  const lb = Leaderboard.create({});
  assert.equal(lb.enabled, false);
  assert.ok(lb.add({ player: 'Bim', mode: 'mini', level: 'easy', timeMs: 61000 }));
  assert.equal(lb.add({ player: 'Stranger', mode: 'mini', level: 'easy', timeMs: 61000 }), null);
  assert.equal((await lb.sync()).length, 1);
});

test('cloud mode queues offline results and uploads them later', async () => {
  reset();
  const server = new Map();
  let online = false;
  const fakeFetch = async (url, opts = {}) => {
    if (!online) throw new Error('offline');
    const u = new URL(url);
    assert.equal(u.searchParams.get('key'), 'KEY');
    if (opts.method === 'POST') {
      const id = u.searchParams.get('documentId');
      if (server.has(id)) return { ok: false, status: 409 };
      server.set(id, JSON.parse(opts.body));
      return { ok: true, status: 200 };
    }
    const documents = [...server].map(([id, d]) => ({ ...d, name: `x/results/${id}` }));
    return { ok: true, status: 200, json: async () => ({ documents }) };
  };
  const lb = Leaderboard.create({ apiKey: 'KEY', projectId: 'demo' }, fakeFetch);
  assert.equal(lb.enabled, true);

  lb.add({ player: 'Johan', mode: 'classic', level: 'hard', timeMs: 500000, hints: 1 });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(lb.pending(), 1);
  assert.equal((await lb.sync()).length, 1); // offline: served from cache
  assert.equal(lb.status(), 'offline');

  online = true;
  const all = await lb.sync();
  assert.equal(lb.status(), 'synced');
  assert.equal(lb.pending(), 0);
  assert.equal(server.size, 1);
  assert.equal(all.length, 1);
  assert.equal(all[0].player, 'Johan');

  // A result refused by the security rules is not retried forever.
  const realFetch = fakeFetch;
  const refusing = async (url, opts = {}) => (opts.method === 'POST' ? { ok: false, status: 403 } : realFetch(url, opts));
  const lb2 = Leaderboard.create({ apiKey: 'KEY', projectId: 'demo' }, refusing);
  lb2.add({ player: 'Bim', mode: 'mini', level: 'easy', timeMs: 100 });
  await lb2.sync();
  assert.equal(lb2.pending(), 0);
  assert.equal(lb2.status(), 'synced');

  // A result added on another device shows up after the next sync.
  server.set('other', Leaderboard.toDoc({ player: 'Bim', mode: 'mini', level: 'easy', timeMs: 70000, hints: 0, date: '2026-02-02T00:00:00Z' }));
  assert.equal((await lb.sync()).length, 2);
});

test('avatars default per player and can be changed on this device', () => {
  reset();
  const lb = Leaderboard.create({ apiKey: 'KEY', projectId: 'demo' }, async () => {
    throw new Error('avatars must not use the network');
  });
  assert.ok(Leaderboard.AVATARS.includes('🌈'));
  assert.ok(Leaderboard.AVATARS.includes('🍬'));
  assert.ok(Leaderboard.AVATARS.includes('🍭'));
  assert.equal(new Set(Leaderboard.AVATARS).size, Leaderboard.AVATARS.length);
  assert.equal(lb.avatar('Bim'), '🦄');
  assert.equal(lb.setAvatar('Bim', '💩'), false, 'unknown avatar rejected');
  assert.equal(lb.setAvatar('Nobody', '🌈'), false, 'unknown player rejected');
  assert.equal(lb.setAvatar('Bim', '🌈'), true);
  assert.equal(lb.avatar('Bim'), '🌈');
  assert.equal(lb.avatar('Wille'), '🦖');
  // Avatars saved by the earlier synced version are still read.
  storage['sudoku-fun-avatars-v1'] = JSON.stringify({ Frans: { icon: '🍭', pending: true } });
  assert.equal(lb.avatar('Frans'), '🍭');
});
