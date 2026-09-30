/*
 * Leaderboard: stores solved-puzzle results and syncs them between devices
 * through Cloud Firestore's REST API (no SDK needed).
 *
 * Results are always kept in a local cache so the leaderboard works offline.
 * New results go into an outbox that is uploaded when the network is back.
 * Without a Firebase config (js/firebase-config.js) it works on this device only.
 *
 * Works as a browser global (window.Leaderboard) and as a CommonJS module.
 */
(function (root) {
  'use strict';

  const PLAYERS = [
    { name: 'Wille', icon: '🦖', color: '#20a75a' },
    { name: 'Johan', icon: '🚀', color: '#3a70f5' },
    { name: 'Bim', icon: '🦄', color: '#e0409a' },
    { name: 'Frans', icon: '🐙', color: '#f7801a' },
  ];
  // Avatars players can pick (stored on each device).
  const AVATARS = [
    '🌈', '🦄', '🦖', '🚀', '🐙', '🐱', '🐶', '🦊',
    '🐼', '🐸', '🦁', '🐯', '🐵', '🐧', '🦋', '🐬',
    '🦈', '🐢', '🐲', '🤖', '👾', '👑', '🌟', '🍕',
    '🍦', '🍬', '🍭', '🍓', '🌸', '🌻', '🎸', '🏀',
  ];
  const MODES = ['mini', 'classic'];
  const LEVELS = ['easy', 'medium', 'hard'];
  const CACHE_KEY = 'sudoku-fun-results-v1';
  const OUTBOX_KEY = 'sudoku-fun-outbox-v1';
  const AVATAR_KEY = 'sudoku-fun-avatars-v1';
  const COLLECTION = 'results';

  function readJSON(key, fallback) {
    try {
      const v = JSON.parse(root.localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      root.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* storage unavailable */
    }
  }

  function newId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- Firestore document conversion ---------- */

  function toDoc(r) {
    return {
      fields: {
        player: { stringValue: r.player },
        mode: { stringValue: r.mode },
        level: { stringValue: r.level },
        timeMs: { integerValue: String(Math.round(r.timeMs)) },
        hints: { integerValue: String(r.hints || 0) },
        date: { timestampValue: r.date },
      },
    };
  }

  function fromDoc(doc) {
    const f = doc.fields || {};
    const str = (k) => (f[k] && f[k].stringValue) || '';
    const int = (k) => Number((f[k] && f[k].integerValue) || 0);
    return {
      id: doc.name.split('/').pop(),
      player: str('player'),
      mode: str('mode'),
      level: str('level'),
      timeMs: int('timeMs'),
      hints: int('hints'),
      date: (f.date && f.date.timestampValue) || '',
    };
  }

  function isValid(r) {
    return (
      r &&
      PLAYERS.some((p) => p.name === r.player) &&
      MODES.includes(r.mode) &&
      LEVELS.includes(r.level) &&
      r.timeMs > 0
    );
  }

  /* ---------- Statistics ---------- */

  /*
   * For every mode and level: number of games (total and per player) and the
   * fastest results, best first.
   */
  function stats(results, top = 3) {
    const out = {};
    for (const mode of MODES) {
      out[mode] = {};
      for (const level of LEVELS) {
        const byPlayer = {};
        PLAYERS.forEach((p) => (byPlayer[p.name] = 0));
        out[mode][level] = { count: 0, byPlayer, best: [] };
      }
    }
    for (const r of results) {
      if (!isValid(r)) continue;
      const bucket = out[r.mode][r.level];
      bucket.count++;
      bucket.byPlayer[r.player]++;
      bucket.best.push(r);
    }
    for (const mode of MODES) {
      for (const level of LEVELS) {
        const b = out[mode][level];
        b.best.sort((a, c) => a.timeMs - c.timeMs || a.hints - c.hints || a.date.localeCompare(c.date));
        b.best = b.best.slice(0, top);
      }
    }
    return out;
  }

  /* ---------- Store with optional cloud sync ---------- */

  function create(config, fetchImpl) {
    const cfg = config || {};
    const enabled = !!(cfg.apiKey && cfg.projectId);
    const doFetch = fetchImpl || (root.fetch && root.fetch.bind(root));
    const base = enabled
      ? `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents/${COLLECTION}`
      : '';
    let status = enabled ? 'idle' : 'local';

    function cache() {
      return readJSON(CACHE_KEY, []);
    }

    function outbox() {
      return readJSON(OUTBOX_KEY, []);
    }

    async function upload(r) {
      const url = `${base}?documentId=${encodeURIComponent(r.id)}&key=${encodeURIComponent(cfg.apiKey)}`;
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toDoc(r)),
      });
      // 409: already uploaded by an earlier retry. 400/403: refused by the
      // security rules, so retrying can never succeed and it is dropped.
      if (!res.ok && ![409, 400, 403].includes(res.status)) throw new Error('Upload failed: ' + res.status);
    }

    async function flush() {
      if (!enabled) return;
      let pending = outbox();
      for (const r of pending.slice()) {
        await upload(r);
        pending = pending.filter((p) => p.id !== r.id);
        writeJSON(OUTBOX_KEY, pending);
      }
    }

    async function download() {
      const all = [];
      let pageToken = '';
      do {
        const url =
          `${base}?pageSize=300&key=${encodeURIComponent(cfg.apiKey)}` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
        const res = await doFetch(url);
        if (!res.ok) throw new Error('Download failed: ' + res.status);
        const body = await res.json();
        (body.documents || []).forEach((d) => all.push(fromDoc(d)));
        pageToken = body.nextPageToken || '';
      } while (pageToken);
      return all;
    }

    /* ---------- Avatars: { name: icon }, kept on this device only ---------- */

    function avatarCache() {
      return readJSON(AVATAR_KEY, {});
    }

    function avatar(name) {
      const saved = avatarCache()[name];
      const icon = saved && saved.icon ? saved.icon : saved; // older format: { icon, pending }
      if (AVATARS.includes(icon)) return icon;
      const p = PLAYERS.find((x) => x.name === name);
      return p ? p.icon : '';
    }

    function setAvatar(name, icon) {
      if (!PLAYERS.some((p) => p.name === name) || !AVATARS.includes(icon)) return false;
      writeJSON(AVATAR_KEY, Object.assign(avatarCache(), { [name]: icon }));
      return true;
    }

    /* Uploads waiting results, then downloads everything. Resolves to all results. */
    async function sync() {
      if (!enabled) return cache();
      status = 'syncing';
      try {
        await flush();
        const remote = await download();
        const ids = new Set(remote.map((r) => r.id));
        const merged = remote.concat(outbox().filter((r) => !ids.has(r.id)));
        writeJSON(CACHE_KEY, merged);
        status = 'synced';
        return merged;
      } catch (e) {
        status = 'offline';
        return cache();
      }
    }

    /* Records a solved puzzle. Returns the stored result. */
    function add(result) {
      const r = Object.assign({ id: newId(), date: new Date().toISOString(), hints: 0 }, result);
      r.timeMs = Math.round(r.timeMs);
      if (!isValid(r)) return null;
      writeJSON(CACHE_KEY, cache().concat([r]));
      if (enabled) {
        writeJSON(OUTBOX_KEY, outbox().concat([r]));
        flush().then(
          () => (status = 'synced'),
          () => (status = 'offline')
        );
      }
      return r;
    }

    return {
      enabled,
      results: cache,
      pending: () => outbox().length,
      status: () => status,
      add,
      sync,
      avatar,
      setAvatar,
    };
  }

  const api = { PLAYERS, AVATARS, MODES, LEVELS, stats, create, toDoc, fromDoc };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Leaderboard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
