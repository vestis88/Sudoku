/* Sudoku Fun – user interface. Game rules live in sudoku.js. */
(function () {
  'use strict';

  const S = window.Sudoku;
  const SAVE_KEY = 'sudoku-fun-save-v1'; // single saved game from older versions
  const GAMES_KEY = 'sudoku-fun-games-v1'; // all unfinished games, newest first
  const MAX_GAMES = 30;
  const PREF_KEY = 'sudoku-fun-prefs-v1';
  const CHECK_MS = 3000;
  const LEVELS = {
    easy: { label: 'Lätt', icon: '🐣' },
    medium: { label: 'Mellan', icon: '🦊' },
    hard: { label: 'Svår', icon: '🦁' },
  };
  const MODES = { mini: 'Mini 6×6', classic: 'Klassisk 9×9', tectonic: 'Tectonic' };
  // Swedish plural names of the digits, e.g. "Alla femmor".
  const DIGIT_NAMES = ['', 'ettor', 'tvåor', 'treor', 'fyror', 'femmor', 'sexor', 'sjuor', 'åttor', 'nior'];
  const CHEERS = ['Bra jobbat!', 'Grymt!', 'Super!', 'Toppen!', 'Wow!', 'Du är bäst!', 'Fantastiskt!'];
  const SPARKS = ['⭐', '✨', '🌟', '💫', '🎉'];

  // fx: 'full' = all animations and confetti, 'light' = a little, 'none' = no effects.
  const THEMES = [
    { id: 'color', name: 'Färgglad', icon: '🌈', fx: 'full' },
    { id: 'space', name: 'Rymd', icon: '🚀', fx: 'full' },
    { id: 'candy', name: 'Godis', icon: '🍬', fx: 'full' },
    { id: 'elegant', name: 'Elegant', icon: '🖋️', fx: 'light' },
    { id: 'plain', name: 'Enkel', icon: '⬜', fx: 'none' },
  ];

  const $ = (sel) => document.querySelector(sel);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(key) {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* storage unavailable – play without saving */
      }
    },
  };

  const prefs = Object.assign({ mode: 'mini', sound: true }, store.get(PREF_KEY) || {});

  const LB = window.Leaderboard;
  const results = LB.create(window.SUDOKU_FIREBASE);
  const PLAYERS = Object.fromEntries(LB.PLAYERS.map((p) => [p.name, p]));
  if (!PLAYERS[prefs.player]) delete prefs.player;
  let lbMode = prefs.mode;
  let lbPlayer = null; // show only this player's best times, or everyone's

  let game = null;
  let selected = -1;
  let cellEls = [];
  let padEls = {};
  let noteEls = {};
  let doneDigits = new Set();
  let checkTimer = null;
  let clockTimer = null;
  let clockStart = Date.now();
  let warnedFull = false;

  /* ---------------- Sound ---------------- */

  const Sound = (function () {
    let ctx = null;
    function tone(freq, dur, type, when, vol) {
      if (!prefs.sound) return;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        const t = ctx.currentTime + (when || 0);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type || 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      } catch (e) {
        /* no audio support */
      }
    }
    const scale = [523, 587, 659, 698, 784, 880, 988, 1047, 1175];
    const seq = (notes, gap, dur) => notes.forEach((f, i) => tone(f, dur, 'triangle', i * gap));
    return {
      place: (v) => tone(scale[v - 1], 0.14),
      note: (v) => tone(scale[v - 1] * 2, 0.07, 'sine', 0, 0.08),
      erase: () => tone(330, 0.08, 'sine'),
      nope: () => tone(180, 0.14, 'square', 0, 0.05),
      good: () => seq([784, 1047, 1319], 0.08, 0.16),
      bad: () => {
        tone(330, 0.14, 'sawtooth', 0, 0.05);
        tone(262, 0.2, 'sawtooth', 0.12, 0.05);
      },
      hint: () => seq([1047, 1319, 1568], 0.06, 0.12),
      done: () => seq([523, 659, 784, 1047], 0.07, 0.16),
      win: () => seq([523, 659, 784, 1047, 784, 1047, 1319], 0.12, 0.22),
      record: () => {
        seq([523, 523, 523, 698, 880, 784, 880, 1047, 1319, 1568], 0.13, 0.3);
        tone(262, 1.6, 'triangle', 1.2, 0.08);
        tone(392, 1.6, 'triangle', 1.2, 0.06);
      },
    };
  })();

  /* ---------------- Helpers ---------------- */

  function savePrefs() {
    store.set(PREF_KEY, prefs);
  }

  const TEC = window.Tectonic;

  const RULES = {
    mini: 'Fyll varje rad, kolumn och block – varje siffra bara en gång!',
    classic: 'Fyll varje rad, kolumn och block – varje siffra bara en gång!',
    tectonic: 'Ett block med 3 rutor får 1, 2 och 3. Lika siffror får aldrig nudda varandra – inte ens snett!',
  };

  function isKnownMode(mode) {
    return !!S.VARIANTS[mode] || mode === 'tectonic';
  }

  // "Klassisk 9×9", or "Tectonic 6×6" (its size depends on the level)
  function modeName(g) {
    return g.mode === 'tectonic' ? `Tectonic ${g.width}×${g.height}` : MODES[g.mode];
  }

  /*
   * The current game's board in one format for sudoku and Tectonic:
   * width/height, how many numbers there are (digits), which cells affect
   * each other (peers), the region of every cell and how many of each
   * number a solved grid holds (needed).
   */
  let geoCache = null;
  function geo() {
    if (geoCache && geoCache.game === game) return geoCache;
    let out;
    if (game.mode === 'tectonic') {
      const t = TEC.geometry(game.width, game.height, game.regions);
      out = { width: t.width, height: t.height, cells: t.cells, digits: t.digits, peers: t.peers, needed: t.needed, regionOf: t.unitOf, tectonic: t };
    } else {
      const v = S.VARIANTS[game.mode];
      const g = S.geometry(v);
      out = { width: v.size, height: v.size, cells: g.cells, digits: v.size, peers: g.peers, needed: new Array(v.size + 1).fill(v.size), regionOf: g.boxOf, variant: v, sudoku: g };
    }
    out.game = game;
    out.peerSets = out.peers.map((p) => new Set(p));
    geoCache = out;
    return out;
  }

  function elapsedMs() {
    return game.elapsed + (Date.now() - clockStart);
  }

  /* ---------------- Saved games ---------------- */

  function savedGames() {
    const list = store.get(GAMES_KEY);
    return Array.isArray(list) ? list.filter((g) => g && g.id && !g.done && isKnownMode(g.mode)) : [];
  }

  // Puts the current game first in the list; finished games are removed.
  function storeGame() {
    const others = savedGames().filter((g) => g.id !== game.id);
    if (!game.done) game.updatedAt = Date.now();
    store.set(GAMES_KEY, (game.done ? others : [game].concat(others)).slice(0, MAX_GAMES));
  }

  function deleteSavedGame(id) {
    store.set(GAMES_KEY, savedGames().filter((g) => g.id !== id));
  }

  // Moves the single save of older versions into the list.
  function migrateOldSave() {
    const old = store.get(SAVE_KEY);
    if (!old) return;
    if (!old.done && S.VARIANTS[old.mode] && !savedGames().length) {
      old.id = old.id || 'g' + Date.now().toString(36);
      old.updatedAt = old.updatedAt || Date.now();
      store.set(GAMES_KEY, [old]);
    }
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function progress(g) {
    let open = 0;
    let filled = 0;
    g.puzzle.forEach((v, i) => {
      if (v) return;
      open++;
      if (g.values[i]) filled++;
    });
    return open ? Math.round((filled / open) * 100) : 100;
  }

  function whenLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (days === 0) return `idag ${time}`;
    if (days === 1) return `igår ${time}`;
    return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  }

  function gameSummary(g) {
    const who = g.player ? `${playerLabel(g.player)} · ` : '';
    return `${who}${modeName(g)} · ${LEVELS[g.level].icon} ${LEVELS[g.level].label}`;
  }

  function resumeGame(id) {
    const g = savedGames().find((x) => x.id === id);
    if (!g) return;
    $('#games-picker').hidden = true;
    game = g;
    startGame();
  }

  function openGamesList() {
    const list = savedGames();
    $('#games-list').innerHTML = list.length
      ? list
          .map((g) => {
            const pct = progress(g);
            return `<li class="saved-game" style="--pc:${g.player && PLAYERS[g.player] ? PLAYERS[g.player].color : 'var(--accent)'}">
              <button class="saved-open" data-id="${g.id}">
                <span class="saved-title">${gameSummary(g)}</span>
                <span class="saved-meta">⏱ ${formatTime(g.elapsed || 0)} · ${pct}% klart · ${whenLabel(g.updatedAt || Date.now())}</span>
                <span class="saved-bar"><span style="width:${pct}%"></span></span>
              </button>
              <button class="saved-delete" data-id="${g.id}" aria-label="Ta bort">🗑</button>
            </li>`;
          })
          .join('')
      : '<li class="saved-empty">Inga sparade spel just nu.</li>';
    $('#games-picker').hidden = false;
  }

  function saveGame() {
    if (!game) return;
    game.elapsed = elapsedMs();
    clockStart = Date.now();
    storeGame();
  }

  let toastTimer = null;
  function toast(text, kind) {
    const el = $('#toast');
    el.textContent = text;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 2200);
  }

  function replayAnimation(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(cls);
  }

  // One-shot animation classes are removed once they finish.
  document.addEventListener('animationend', (e) => {
    ['pop', 'wiggle', 'just-done', 'wave', 'rainbow'].forEach((c) => e.target.classList.remove(c));
  });

  function burst(el, count) {
    if (reduceMotion || theme().fx !== 'full') return;
    const rect = el.getBoundingClientRect();
    const layer = $('#fx');
    for (let k = 0; k < count; k++) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.textContent = SPARKS[k % SPARKS.length];
      const angle = (Math.PI * 2 * k) / count + Math.random() * 0.5;
      const dist = 50 + Math.random() * 50;
      s.style.left = rect.left + rect.width / 2 + 'px';
      s.style.top = rect.top + rect.height / 2 + 'px';
      s.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      s.addEventListener('animationend', () => s.remove());
      layer.appendChild(s);
    }
  }

  /* ---------------- Confetti ---------------- */

  // One shared particle loop, so several bursts can run at the same time.
  const Confetti = (function () {
    const COLORS = ['#ef476f', '#f7801a', '#ffc93c', '#20a75a', '#0fa9c0', '#3a70f5', '#8b5cf6', '#e0409a'];
    const GOLD = ['#ffc93c', '#ffd95a', '#ffe680', '#f7b500', '#fff3b0'];
    const SUBTLE = ['#b8872b', '#d9c9a3', '#1f3a5f', '#8e3b46', '#5f7f6a'];
    let parts = [];
    let running = false;
    let ctx = null;

    function setup() {
      const canvas = $('#confetti');
      const dpr = window.devicePixelRatio || 1;
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // angle in degrees (-90 = straight up), spread in degrees
    function burst(o) {
      const n = reduceMotion ? Math.ceil(o.count / 5) : o.count;
      const colors = o.colors || COLORS;
      for (let k = 0; k < n; k++) {
        const a = ((o.angle + (Math.random() - 0.5) * o.spread) * Math.PI) / 180;
        const speed = o.power * (0.55 + Math.random() * 0.6);
        parts.push({
          x: o.x + (Math.random() - 0.5) * (o.width || 0),
          y: o.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          size: 6 + Math.random() * 8,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          color: colors[Math.floor(Math.random() * colors.length)],
          shape: o.star ? 'star' : Math.random() < 0.3 ? 'round' : 'rect',
          gravity: o.gravity == null ? 0.35 : o.gravity,
          age: 0,
          life: o.life || 4000,
        });
      }
      if (!running) {
        setup();
        running = true;
        let last = performance.now();
        requestAnimationFrame(function frame(now) {
          const dt = Math.min(50, now - last);
          last = now;
          ctx.clearRect(0, 0, innerWidth, innerHeight);
          parts = parts.filter((p) => p.age < p.life && p.y < innerHeight + 60);
          for (const p of parts) {
            p.age += dt;
            p.vy += p.gravity;
            p.vx *= 0.99;
            p.x += p.vx;
            p.y += p.vy;
            p.rot += p.vr;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = Math.max(0, Math.min(1, (p.life - p.age) / 800));
            ctx.fillStyle = p.color;
            if (p.shape === 'star') {
              ctx.font = `${p.size * 2}px sans-serif`;
              ctx.fillText('⭐', -p.size, p.size);
            } else if (p.shape === 'round') {
              ctx.beginPath();
              ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
              ctx.fill();
            } else {
              ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            }
            ctx.restore();
          }
          if (parts.length) requestAnimationFrame(frame);
          else {
            running = false;
            ctx.clearRect(0, 0, innerWidth, innerHeight);
          }
        });
      }
    }

    return {
      // Normal win: one burst from the middle.
      win() {
        const fx = theme().fx;
        if (fx === 'none') return;
        if (fx === 'light') {
          burst({ x: innerWidth / 2, y: innerHeight * 0.4, count: 50, angle: -90, spread: 90, power: 13, colors: SUBTLE });
          return;
        }
        burst({ x: innerWidth / 2, y: innerHeight * 0.45, count: 180, angle: -90, spread: 120, power: 17, width: 120 });
      },
      // Record: cannons from both bottom corners, three times, plus falling gold stars.
      record() {
        const fx = theme().fx;
        if (fx === 'none') return;
        if (fx === 'light') {
          burst({ x: 0, y: innerHeight, count: 50, angle: -60, spread: 25, power: 22, colors: SUBTLE });
          burst({ x: innerWidth, y: innerHeight, count: 50, angle: -120, spread: 25, power: 22, colors: SUBTLE });
          return;
        }
        [0, 700, 1400].forEach((delay) =>
          setTimeout(() => {
            burst({ x: 0, y: innerHeight, count: 110, angle: -60, spread: 30, power: 24 });
            burst({ x: innerWidth, y: innerHeight, count: 110, angle: -120, spread: 30, power: 24 });
          }, delay)
        );
        setTimeout(
          () =>
            burst({ x: innerWidth / 2, y: -20, count: 40, angle: 90, spread: 40, power: 3, width: innerWidth, gravity: 0.08, star: true, life: 6000 }),
          300
        );
        burst({ x: innerWidth / 2, y: innerHeight * 0.22, count: 60, angle: -90, spread: 360, power: 10, colors: GOLD });
      },
    };
  })();


  /* ---------------- Home screen ---------------- */

  /* ---------------- Themes ---------------- */

  function theme() {
    return THEMES.find((t) => t.id === prefs.theme) || THEMES[0];
  }

  function applyTheme() {
    const t = theme();
    document.documentElement.dataset.theme = t.id;
    buildLogo();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    document.querySelectorAll('.theme-card').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.theme === t.id)));
  }

  function openThemePicker() {
    const grid = $('#theme-grid');
    if (!grid.children.length) {
      // [number, given?] for the small preview board
      const sample = [[5, 1], [2, 0], [3, 1], [4, 0], [7, 1], [6, 0], [8, 1], [9, 0], [1, 1]];
      THEMES.forEach((t) => {
        const card = document.createElement('button');
        card.className = 'theme-card';
        card.dataset.theme = t.id;
        card.setAttribute('role', 'radio');
        const cells = sample
          .map(([d, given]) => `<span class="tp-cell${given ? ' g' : ''}" style="--dc:var(--d${d})">${d}</span>`)
          .join('');
        card.innerHTML = `<span class="tp-board">${cells}</span><span class="tp-name">${t.icon} ${t.name}</span>`;
        card.addEventListener('click', () => {
          prefs.theme = t.id;
          savePrefs();
          applyTheme();
        });
        grid.appendChild(card);
      });
    }
    applyTheme();
    $('#theme-picker').hidden = false;
    grid.querySelector('[aria-checked="true"]').focus();
  }

  function buildLogo() {
    const word = 'Sudoku';
    const colors = ['--d1', '--d2', '--d3', '--d4', '--d5', '--d6', '--d7', '--d8'];
    let k = 0;
    $('#logo').innerHTML = '';
    [...word].forEach((ch, i) => {
      const span = document.createElement('span');
      if (ch === ' ') {
        span.className = 'space';
      } else {
        span.textContent = ch;
        span.style.color = `var(${colors[k++ % colors.length]})`;
        span.style.animationDelay = i * 0.12 + 's';
      }
      $('#logo').appendChild(span);
    });
  }

  // Small picture of a Tectonic board: tinted regions with a few numbers.
  function buildTectonicPreview(el) {
    const p = TEC.generate('easy', 11);
    const t = TEC.geometry(p.width, p.height, p.regions);
    const tints = regionTints(t);
    el.classList.add('tec');
    el.style.gridTemplateColumns = `repeat(${p.width}, 1fr)`;
    el.style.gridTemplateRows = `repeat(${p.height}, 1fr)`;
    for (let i = 0; i < t.cells; i++) {
      const cell = document.createElement('span');
      cell.className = 'pcell tcell';
      cell.style.setProperty('--tint', `var(--d${tints[t.unitOf[i]]})`);
      const r = Math.floor(i / p.width);
      const c = i % p.width;
      const other = (rr, cc) => rr < 0 || cc < 0 || rr >= p.height || cc >= p.width || t.unitOf[rr * p.width + cc] !== t.unitOf[i];
      if (other(r - 1, c)) cell.classList.add('et');
      if (other(r + 1, c)) cell.classList.add('eb');
      if (other(r, c - 1)) cell.classList.add('el');
      if (other(r, c + 1)) cell.classList.add('er');
      if (p.puzzle[i]) {
        cell.textContent = p.puzzle[i];
        cell.style.setProperty('--dc', `var(--d${p.puzzle[i]})`);
      }
      el.appendChild(cell);
    }
  }

  function buildPreview(el, v) {
    const g = S.geometry(v);
    el.style.gridTemplateColumns = `repeat(${v.size / v.boxCols}, 1fr)`;
    el.style.gridTemplateRows = `repeat(${v.size / v.boxRows}, 1fr)`;
    const boxes = [];
    for (let b = 0; b < v.size; b++) {
      const box = document.createElement('span');
      box.className = 'pbox';
      box.style.gridTemplateColumns = `repeat(${v.boxCols}, 1fr)`;
      box.style.gridTemplateRows = `repeat(${v.boxRows}, 1fr)`;
      boxes.push(box);
      el.appendChild(box);
    }
    // A fixed, valid-looking sprinkling of coloured dots.
    const solution = S.generate(v.id, 'easy', 7).puzzle;
    for (let i = 0; i < g.cells; i++) {
      const cell = document.createElement('span');
      cell.className = 'pcell';
      if (solution[i] && i % 3 !== 1) {
        cell.classList.add('dot');
        cell.style.setProperty('--dc', `var(--d${solution[i]})`);
      }
      boxes[g.boxOf[i]].appendChild(cell);
    }
  }

  function formatTime(ms) {
    const secs = Math.floor(ms / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = String(secs % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function avatarOf(name) {
    return results.avatar(name);
  }

  function playerLabel(name) {
    return PLAYERS[name] ? `${avatarOf(name)} ${name}` : '';
  }

  function buildPlayers() {
    const wrap = $('#players');
    LB.PLAYERS.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'player-card';
      card.style.setProperty('--pc', p.color);

      const btn = document.createElement('button');
      btn.className = 'player-btn';
      btn.setAttribute('role', 'radio');
      btn.dataset.player = p.name;
      btn.innerHTML = `<span class="player-icon"></span><span class="player-name">${p.name}</span>`;
      btn.addEventListener('click', () => {
        prefs.player = p.name;
        savePrefs();
        renderHome();
        burst(btn, 6);
      });

      const edit = document.createElement('button');
      edit.className = 'player-edit';
      edit.dataset.player = p.name;
      edit.textContent = '✏️';
      edit.setAttribute('aria-label', `Byt figur för ${p.name}`);
      edit.addEventListener('click', () => openPicker(p.name));

      card.append(btn, edit);
      wrap.appendChild(card);
    });
    renderPlayers();
  }

  function renderPlayers() {
    document.querySelectorAll('.player-btn').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.player === prefs.player));
      btn.querySelector('.player-icon').textContent = avatarOf(btn.dataset.player);
    });
  }

  /* ---------------- Avatar picker ---------------- */

  let pickerFor = null;

  function openPicker(name) {
    pickerFor = name;
    const current = avatarOf(name);
    $('#picker-title').textContent = `Välj din figur, ${name}!`;
    $('.picker-card').style.setProperty('--pc', PLAYERS[name].color);
    const grid = $('#avatar-grid');
    grid.innerHTML = '';
    LB.AVATARS.forEach((icon, k) => {
      const b = document.createElement('button');
      b.className = 'avatar-option';
      b.textContent = icon;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(icon === current));
      b.style.animationDelay = `${k * 15}ms`;
      b.addEventListener('click', () => chooseAvatar(icon));
      grid.appendChild(b);
    });
    $('#avatar-picker').hidden = false;
    grid.querySelector('[aria-checked="true"]').focus();
  }

  function closePicker() {
    $('#avatar-picker').hidden = true;
    pickerFor = null;
  }

  function chooseAvatar(icon) {
    const name = pickerFor;
    if (!name || !results.setAvatar(name, icon)) return;
    closePicker();
    renderPlayers();
    renderLeaderboard();
    Sound.good();
    const btn = document.querySelector(`.player-btn[data-player="${name}"]`);
    replayAnimation(btn.querySelector('.player-icon'), 'pop');
    burst(btn, 8);
    toast(`Snyggt, ${name}! ${icon}`);
  }

  function renderHome() {
    document.querySelectorAll('.mode-card').forEach((card) => {
      card.setAttribute('aria-checked', String(card.dataset.mode === prefs.mode));
    });
    renderPlayers();
    $('#tagline').textContent = RULES[prefs.mode] || RULES.classic;
    $('.levels').classList.toggle('locked', !prefs.player);
    const games = savedGames();
    $('#continue').hidden = !games.length;
    if (games.length) {
      $('#continue-label').textContent = `${gameSummary(games[0])} · ${progress(games[0])}%`;
    }
    $('#btn-games').hidden = games.length < 2;
    $('#games-count').textContent = games.length;
    renderLeaderboard();
  }

  function renderLeaderboard() {
    document.querySelectorAll('.lb-tab').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.mode === lbMode));
    });
    const status = results.status();
    const pending = results.pending();
    $('#lb-status').textContent = !results.enabled
      ? '📱 Bara den här enheten'
      : status === 'syncing'
        ? '☁️ Synkar…'
        : status === 'offline'
          ? `📴 Offline${pending ? ` – ${pending} väntar` : ''}`
          : status === 'synced'
            ? '☁️ Synkad'
            : '☁️';
    const stats = LB.stats(results.results(), 5, lbPlayer)[lbMode];
    const medals = ['🥇', '🥈', '🥉', '4', '5'];
    // Swedish genitive: "Bims", but "Frans" stays "Frans"
    const whose = lbPlayer && (lbPlayer.endsWith('s') ? lbPlayer : lbPlayer + 's');
    $('#lb-note').textContent = lbPlayer
      ? `${avatarOf(lbPlayer)} ${whose} bästa tider utan ledtrådar · tryck igen för alla`
      : 'Bästa tider utan ledtrådar 💡 · tryck på en figur för en spelares egna tider';
    const dateFmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' });
    $('#lb-levels').innerHTML = LB.LEVELS.map((level) => {
      const s = stats[level];
      const lvl = LEVELS[level];
      const best = s.best.length
        ? `<ol class="lb-best">${s.best
            .map(
              (r, k) => `<li class="${r.player === prefs.player && !lbPlayer ? 'me' : ''}" style="--pc:${PLAYERS[r.player].color}">
                <span class="lb-medal${k > 2 ? ' lb-rank' : ''}">${medals[k]}</span>
                ${
                  lbPlayer
                    ? `<span class="lb-player lb-date">${r.date ? dateFmt.format(new Date(r.date)) : ''}</span>`
                    : `<button class="lb-player lb-who" data-player="${r.player}">${playerLabel(r.player)}</button>`
                }
                <span class="lb-time">${formatTime(r.timeMs)}</span>
              </li>`
            )
            .join('')}</ol>`
        : lbPlayer
          ? `<p class="lb-empty">${lbPlayer} har ingen tid utan ledtrådar här än.</p>`
          : '<p class="lb-empty">Ingen tid utan ledtrådar än – bli först! 🌟</p>';
      const played = LB.PLAYERS.map(
        (p) =>
          `<button class="lb-chip" data-player="${p.name}" aria-pressed="${p.name === lbPlayer}" style="--pc:${p.color}" title="${p.name}: ${s.byPlayer[p.name]} spelade">${avatarOf(p.name)} ${s.byPlayer[p.name]}</button>`
      ).join('');
      return `<div class="lb-card">
        <div class="lb-card-head"><span class="lb-level">${lvl.icon} ${lvl.label}</span><span class="lb-count">${s.count} ${s.count === 1 ? 'spelad' : 'spelade'}</span></div>
        ${best}
        <div class="lb-played" aria-label="Spelade per spelare">${played}</div>
      </div>`;
    }).join('');
  }

  function refreshLeaderboard() {
    renderLeaderboard();
    results.sync().then(() => {
      renderPlayers();
      renderLeaderboard();
    });
  }

  function showHome() {
    stopClock();
    if (game && !game.done) saveGame();
    clearChecks();
    document.body.classList.remove('playing');
    $('#game').hidden = true;
    $('#win').hidden = true;
    $('#home').hidden = false;
    $('#home').scrollTop = 0;
    renderHome();
    refreshLeaderboard();
  }

  /* ---------------- Game setup ---------------- */

  function newGame(mode, level, player) {
    if (!PLAYERS[player]) {
      Sound.nope();
      replayAnimation($('#players'), 'wiggle');
      $('#players').scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Välj vem som spelar först 👆');
      return;
    }
    const g = mode === 'tectonic' ? TEC.generate(level) : S.generate(mode, level);
    game = {
      id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      player,
      mode,
      level,
      // Tectonic boards also carry their own shape
      ...(mode === 'tectonic' ? { width: g.width, height: g.height, regions: g.regions } : {}),
      puzzle: g.puzzle,
      solution: g.solution,
      values: g.puzzle.slice(),
      notes: new Array(g.puzzle.length).fill(0), // candidate bitmask per cell
      hinted: [],
      history: [],
      hints: 0,
      elapsed: 0,
      done: false,
    };
    prefs.mode = mode;
    prefs.level = level;
    savePrefs();
    startGame();
  }

  function startGame() {
    selected = -1;
    warnedFull = false;
    clockStart = Date.now();
    if (!game.notes) game.notes = new Array(game.values.length).fill(0);
    $('#home').hidden = true;
    $('#win').hidden = true;
    $('#game').hidden = false;
    document.body.classList.add('playing');
    const lvl = LEVELS[game.level];
    const who = game.player ? `${playerLabel(game.player)} · ` : '';
    $('#chip').textContent = `${who}${modeName(game)} · ${lvl.icon} ${lvl.label}`;
    startClock();
    if (game.mode === 'tectonic' && !game.history.length) toast('Tips: lika siffror får inte nudda varandra – inte ens snett! 👀');
    buildBoard();
    buildPad();
    doneDigits = new Set();
    updatePad(false);
    saveGame();
  }

  function makeCell(i) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.dataset.i = i;
    cell.setAttribute('role', 'gridcell');
    cell.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      select(i);
    });
    cell.addEventListener('click', () => select(i)); // keyboard activation
    return cell;
  }

  /*
   * Tectonic board: one grid of cells. Region borders are drawn thick on the
   * sides where the neighbouring cell belongs to another region, and regions
   * get alternating soft tints (no two touching regions share a tint).
   */
  function buildTectonicBoard() {
    const G = geo();
    const t = G.tectonic;
    const board = $('#board');
    board.innerHTML = '';
    board.classList.add('tectonic');
    board.style.setProperty('--n', G.width);
    board.style.setProperty('--cols', G.width);
    board.style.setProperty('--rows', G.height);
    const tints = regionTints(t);
    cellEls = [];
    for (let i = 0; i < G.cells; i++) {
      const cell = makeCell(i);
      const r = Math.floor(i / G.width);
      const c = i % G.width;
      const other = (rr, cc) => rr < 0 || cc < 0 || rr >= G.height || cc >= G.width || t.unitOf[rr * G.width + cc] !== t.unitOf[i];
      if (other(r - 1, c)) cell.classList.add('et');
      if (other(r + 1, c)) cell.classList.add('eb');
      if (other(r, c - 1)) cell.classList.add('el');
      if (other(r, c + 1)) cell.classList.add('er');
      cell.style.setProperty('--tint', `var(--d${tints[t.unitOf[i]]})`);
      cellEls.push(cell);
      board.appendChild(cell);
      renderCell(i);
    }
    renderHighlights();
  }

  // Greedy colouring so that regions that touch get different tints.
  function regionTints(t) {
    const palette = [1, 4, 6, 7, 2, 5];
    const tint = [];
    t.units.forEach((unit, u) => {
      const used = new Set();
      unit.forEach((i) => t.neighbors[i].forEach((n) => t.unitOf[n] !== u && tint[t.unitOf[n]] && used.add(tint[t.unitOf[n]])));
      tint[u] = palette.find((p) => !used.has(p)) || palette[u % palette.length];
    });
    return tint;
  }

  function buildBoard() {
    if (game.mode === 'tectonic') return buildTectonicBoard();
    const v = geo().variant;
    const g = geo().sudoku;
    const board = $('#board');
    board.innerHTML = '';
    board.classList.remove('tectonic');
    board.style.setProperty('--n', v.size);
    board.style.setProperty('--boxes-across', v.size / v.boxCols);
    board.style.setProperty('--boxes-down', v.size / v.boxRows);
    board.style.setProperty('--box-cols', v.boxCols);
    board.style.setProperty('--box-rows', v.boxRows);

    const across = v.size / v.boxCols;
    const boxes = [];
    for (let b = 0; b < v.size; b++) {
      const box = document.createElement('div');
      box.className = 'box';
      if ((Math.floor(b / across) + (b % across)) % 2) box.classList.add('alt');
      box.setAttribute('role', 'presentation');
      boxes.push(box);
      board.appendChild(box);
    }
    cellEls = [];
    for (let i = 0; i < g.cells; i++) {
      const cell = makeCell(i);
      cellEls.push(cell);
      boxes[g.boxOf[i]].appendChild(cell);
      renderCell(i);
    }
    renderHighlights();
  }

  function buildPad() {
    const digits = geo().digits;
    const pad = $('#pad');
    pad.innerHTML = '';
    pad.style.setProperty('--n', digits);
    pad.style.setProperty('--pad-rows', Math.ceil(digits / 3));
    const notePad = $('#notes-pad');
    notePad.innerHTML = '';
    notePad.style.setProperty('--n', digits);
    notePad.style.setProperty('--pad-rows', Math.ceil(digits / 3));
    padEls = {};
    noteEls = {};
    for (let d = 1; d <= digits; d++) {
      const btn = document.createElement('button');
      btn.className = 'pad-btn';
      btn.style.setProperty('--dc', `var(--d${d})`);
      btn.innerHTML = `<span class="num">${d}</span><span class="left"></span>`;
      btn.addEventListener('click', () => enter(d));
      padEls[d] = btn;
      pad.appendChild(btn);

      const note = document.createElement('button');
      note.className = 'note-btn';
      note.style.setProperty('--dc', `var(--d${d})`);
      note.textContent = d;
      note.setAttribute('aria-label', `Anteckna ${d}`);
      note.addEventListener('click', () => enterNote(d));
      noteEls[d] = note;
      notePad.appendChild(note);
    }
  }

  /* ---------------- Rendering ---------------- */

  function noteDigits(mask) {
    const out = [];
    for (let d = 1; d <= 9; d++) if (mask & (1 << d)) out.push(d);
    return out;
  }

  // Candidate notes shrink as more of them are added: [columns, size factor].
  function noteLayout(count) {
    if (count <= 1) return [1, 0.3];
    if (count === 2) return [2, 0.28];
    if (count <= 4) return [2, 0.26];
    return [3, 0.22];
  }

  function renderCell(i) {
    const el = cellEls[i];
    const val = game.values[i];
    const notes = val ? [] : noteDigits(game.notes[i]);
    const w = geo().width;
    el.textContent = val || '';
    if (notes.length) {
      const [cols, factor] = noteLayout(notes.length);
      const wrap = document.createElement('span');
      wrap.className = 'notes';
      wrap.style.setProperty('--cols', cols);
      wrap.style.setProperty('--nf', factor);
      for (const d of notes) {
        const n = document.createElement('span');
        n.className = 'note';
        n.dataset.d = d;
        n.style.setProperty('--dc', `var(--d${d})`);
        n.textContent = d;
        wrap.appendChild(n);
      }
      el.appendChild(wrap);
    }
    el.style.setProperty('--dc', val ? `var(--d${val})` : 'var(--ink)');
    el.classList.toggle('given', !!game.puzzle[i]);
    el.classList.toggle('hinted', game.hinted.includes(i));
    const content = val ? val : notes.length ? `anteckningar ${notes.join(', ')}` : 'tom';
    el.setAttribute(
      'aria-label',
      `Rad ${Math.floor(i / w) + 1}, kolumn ${(i % w) + 1}, ${content}${game.puzzle[i] ? ', låst' : ''}`
    );
  }

  function renderAllCells() {
    for (let i = 0; i < cellEls.length; i++) renderCell(i);
  }

  function renderHighlights() {
    const peers = selected >= 0 ? geo().peerSets[selected] : null;
    const selVal = selected >= 0 ? game.values[selected] : 0;
    for (let i = 0; i < cellEls.length; i++) {
      const el = cellEls[i];
      const related = !!peers && peers.has(i);
      el.classList.toggle('selected', i === selected);
      el.classList.toggle('related', related);
      el.classList.toggle('same', !!selVal && i !== selected && game.values[i] === selVal);
      if (game.notes[i]) {
        el.querySelectorAll('.note').forEach((n) => n.classList.toggle('hl', Number(n.dataset.d) === selVal));
      }
    }
  }

  function countDigits() {
    const counts = new Array(geo().digits + 1).fill(0);
    for (const v of game.values) counts[v]++;
    return counts;
  }

  function updatePad(celebrate) {
    const { digits, needed } = geo();
    const counts = countDigits();
    for (let d = 1; d <= digits; d++) {
      const left = needed[d] - counts[d];
      const btn = padEls[d];
      const done = left <= 0;
      btn.querySelector('.left').textContent = done ? '✓' : left;
      btn.classList.toggle('done', done);
      noteEls[d].classList.toggle('done', done);
      btn.setAttribute('aria-label', done ? `${d}, alla placerade` : `${d}, ${left} kvar`);
      if (done && !doneDigits.has(d)) {
        doneDigits.add(d);
        if (celebrate) celebrateDigit(d);
      } else if (!done) {
        doneDigits.delete(d);
      }
    }
  }

  function celebrateDigit(d) {
    Sound.done();
    replayAnimation(padEls[d], 'just-done');
    burst(padEls[d], 10);
    let k = 0;
    game.values.forEach((v, i) => {
      if (v !== d) return;
      cellEls[i].style.setProperty('--i', k++);
      replayAnimation(cellEls[i], 'wave');
    });
    if (!isSolved()) toast(`Alla ${DIGIT_NAMES[d]} är på brädet! ⭐`, 'gold');
  }

  /* ---------------- Actions ---------------- */

  function select(i) {
    if (!game || game.done) return;
    selected = i;
    renderHighlights();
  }

  // True when the selected cell can be changed; otherwise explains why not.
  function canEditSelected() {
    if (!game || game.done) return false;
    if (selected < 0) {
      Sound.nope();
      replayAnimation($('#board'), 'wiggle');
      toast('Tryck på en ruta först 👆');
      return false;
    }
    if (game.puzzle[selected]) {
      Sound.nope();
      replayAnimation(cellEls[selected], 'wiggle');
      toast('Den siffran är låst 🔒');
      return false;
    }
    return true;
  }

  function enterNote(d) {
    if (canEditSelected()) toggleNote(selected, d);
  }

  function enter(d) {
    if (!canEditSelected()) return;
    if (game.values[selected] === d) {
      setValue(selected, 0); // tapping the same number again removes it
      return;
    }
    if (doneDigits.has(d)) {
      Sound.nope();
      replayAnimation(padEls[d], 'wiggle');
      toast(`Alla ${DIGIT_NAMES[d]} är redan använda!`);
      return;
    }
    setValue(selected, d);
  }

  // Snapshot taken before every move so undo can restore values and notes.
  function pushHistory(i) {
    game.history.push({ i, prev: game.values[i], notes: game.notes.slice() });
    if (game.history.length > 500) game.history.shift();
  }

  function toggleNote(i, d) {
    if (game.values[i]) {
      Sound.nope();
      replayAnimation(cellEls[i], 'wiggle');
      toast('Rutan har redan en siffra – sudda den först');
      return;
    }
    if (doneDigits.has(d)) {
      Sound.nope();
      replayAnimation(noteEls[d], 'wiggle');
      toast(`Alla ${DIGIT_NAMES[d]} är redan använda!`);
      return;
    }
    pushHistory(i);
    game.notes[i] ^= 1 << d;
    renderCell(i);
    Sound.note(d);
    renderHighlights();
    saveGame();
  }

  function setValue(i, v, opts) {
    const o = Object.assign({ record: true, hint: false }, opts);
    const prev = game.values[i];
    if (prev === v) return;
    if (o.record) pushHistory(i);
    game.values[i] = v;
    game.hinted = game.hinted.filter((h) => h !== i);
    if (o.hint) game.hinted.push(i);
    cellEls[i].classList.remove('correct', 'wrong');
    if (v) {
      // A locked-in answer replaces the cell's notes and removes that
      // number from the notes of its row, column and box.
      game.notes[i] = 0;
      const bit = 1 << v;
      for (const p of geo().peers[i]) {
        if (game.notes[p] & bit) {
          game.notes[p] &= ~bit;
          renderCell(p);
        }
      }
    }
    renderCell(i);
    if (v) {
      replayAnimation(cellEls[i], 'pop');
      if (!o.hint) Sound.place(v);
    } else {
      Sound.erase();
    }
    renderHighlights();
    updatePad(true);
    saveGame();
    afterMove();
  }

  function isSolved() {
    return game.values.every((v, i) => v === game.solution[i]);
  }

  function afterMove() {
    if (isSolved()) {
      win();
      return;
    }
    const full = game.values.every(Boolean);
    if (full && !warnedFull) {
      warnedFull = true;
      toast('Allt är ifyllt! Några behöver rättas – tryck på Kolla ✓');
    } else if (!full) {
      warnedFull = false;
    }
  }

  function erase() {
    if (!game || game.done || selected < 0) return;
    if (game.puzzle[selected]) {
      Sound.nope();
      replayAnimation(cellEls[selected], 'wiggle');
      return;
    }
    if (game.values[selected]) {
      setValue(selected, 0);
    } else if (game.notes[selected]) {
      pushHistory(selected);
      game.notes[selected] = 0;
      renderCell(selected);
      Sound.erase();
      saveGame();
    }
  }

  function undo() {
    if (!game || game.done) return;
    const last = game.history.pop();
    if (!last) {
      toast('Inget att ångra');
      return;
    }
    selected = last.i;
    game.values[last.i] = last.prev;
    if (last.notes) game.notes = last.notes;
    game.hinted = game.hinted.filter((h) => h !== last.i);
    cellEls[last.i].classList.remove('correct', 'wrong');
    renderAllCells();
    if (last.prev) replayAnimation(cellEls[last.i], 'pop');
    Sound.erase();
    renderHighlights();
    updatePad(true);
    saveGame();
    afterMove();
  }

  function clearChecks() {
    clearTimeout(checkTimer);
    cellEls.forEach((el) => el.classList.remove('correct', 'wrong'));
  }

  function check() {
    if (!game || game.done) return;
    clearChecks();
    let right = 0;
    let wrong = 0;
    game.values.forEach((v, i) => {
      if (!v || game.puzzle[i]) return;
      const ok = v === game.solution[i];
      cellEls[i].classList.add(ok ? 'correct' : 'wrong');
      if (ok) right++;
      else wrong++;
    });
    if (right + wrong === 0) {
      toast('Fyll i några siffror först! ✏️');
      return;
    }
    if (wrong === 0) {
      Sound.good();
      const cheer = CHEERS[Math.floor(Math.random() * CHEERS.length)];
      toast(right === 1 ? `${cheer} Den är rätt! 🎉` : `${cheer} Alla ${right} är rätt! 🎉`, 'good');
    } else {
      Sound.bad();
      toast(`${right} rätt, ${wrong} att rätta – du klarar det! 💪`, 'bad');
    }
    checkTimer = setTimeout(clearChecks, CHECK_MS);
  }

  function hint() {
    if (!game || game.done) return;
    const needsHelp = (i) => !game.puzzle[i] && game.values[i] !== game.solution[i];
    let target = selected >= 0 && needsHelp(selected) ? selected : -1;
    if (target < 0) {
      const empty = [];
      const wrong = [];
      game.values.forEach((v, i) => {
        if (needsHelp(i)) (v ? wrong : empty).push(i);
      });
      const pool = empty.length ? empty : wrong;
      if (!pool.length) return;
      target = pool[Math.floor(Math.random() * pool.length)];
    }
    game.hints++;
    selected = target;
    Sound.hint();
    setValue(target, game.solution[target], { hint: true });
    burst(cellEls[target], 6);
  }

  // Fastest time without hints (only those count for records and the leaderboard).
  function bestTime(mode, level, player) {
    const times = results
      .results()
      .filter((r) => r.mode === mode && r.level === level && !r.hints && (!player || r.player === player))
      .map((r) => r.timeMs);
    return times.length ? Math.min(...times) : 0;
  }

  /* ---------------- Timer ---------------- */

  function renderClock() {
    if (!game) return;
    $('#timer-time').textContent = formatTime(game.done ? game.elapsed : elapsedMs());
  }

  function startClock() {
    stopClock();
    const best = game.player ? bestTime(game.mode, game.level, game.player) : 0;
    $('#timer-best').hidden = !best;
    $('#timer-best').textContent = best ? `🏅 ${formatTime(best)}` : '';
    $('#timer-best').title = best ? 'Ditt rekord' : '';
    renderClock();
    clockTimer = setInterval(renderClock, 250);
  }

  function stopClock() {
    clearInterval(clockTimer);
    clockTimer = null;
  }

  function formatDiff(ms) {
    const secs = Math.max(1, Math.round(ms / 1000));
    return secs < 60 ? `${secs} s` : formatTime(secs * 1000);
  }

  /*
   * Saves the solve time and works out whether it is a record:
   * 'all' (fastest of everyone), 'personal' (beat own best), 'first'
   * (first solve of this board and level) or ''.
   */
  function recordResult() {
    const none = { kind: '', prevMine: 0 };
    if (!game.player || game.recorded) return none;
    const best = bestTime(game.mode, game.level);
    const mine = bestTime(game.mode, game.level, game.player);
    const playedBefore = results
      .results()
      .some((r) => r.mode === game.mode && r.level === game.level && r.player === game.player);
    const saved = results.add({
      player: game.player,
      mode: game.mode,
      level: game.level,
      timeMs: game.elapsed,
      hints: game.hints,
    });
    game.recorded = true;
    if (!saved) return none;
    if (game.hints) return { kind: 'hinted', prevMine: 0 };
    const beatsAll = best > 0 && game.elapsed < best;
    if (beatsAll) return { kind: 'all', prevMine: mine };
    if (!playedBefore) return { kind: 'first', prevMine: 0 };
    if (!mine) return { kind: 'first-clean', prevMine: 0 };
    if (game.elapsed < mine) return { kind: 'personal', prevMine: mine };
    return none;
  }

  function buildBanner(text) {
    const colors = ['--d1', '--d2', '--d3', '--d4', '--d5', '--d6', '--d7', '--d8'];
    return [...text]
      .map((ch, i) =>
        ch === ' '
          ? '<span class="space"></span>'
          : `<span style="color:var(${colors[i % colors.length]});animation-delay:${i * 0.07}s">${ch}</span>`
      )
      .join('');
  }

  function win() {
    game.done = true;
    game.elapsed = elapsedMs();
    stopClock();
    renderClock();
    $('#toast').className = 'toast';
    const record = recordResult();
    storeGame(); // a finished game leaves the saved games list
    clearChecks();
    selected = -1;
    renderHighlights();
    const isRecord = record.kind === 'all' || record.kind === 'personal';
    if (isRecord) Sound.record();
    else Sound.win();
    cellEls.forEach((el, i) => {
      el.style.setProperty('--i', i);
      replayAnimation(el, 'rainbow');
    });
    const stars = game.hints === 0 ? 3 : game.hints <= 2 ? 2 : 1;
    const time = formatTime(game.elapsed);
    const lvl = LEVELS[game.level];
    const who = game.player ? `${playerLabel(game.player)} · ` : '';
    setTimeout(() => {
      if (isRecord) Confetti.record();
      else Confetti.win();
      const where = `${modeName(game)} · ${lvl.label}`;
      $('.win-card').classList.toggle('is-record', isRecord);
      $('#win-banner').hidden = !isRecord;
      $('#win-banner').innerHTML = isRecord ? buildBanner('NYTT REKORD!') : '';
      $('#win-title').textContent = isRecord ? `Wow, ${game.player}!` : 'Du klarade det!';
      $('#win-record-detail').hidden = !isRecord;
      $('#win-record-detail').innerHTML = !isRecord
        ? ''
        : record.prevMine
          ? `Förut <s>${formatTime(record.prevMine)}</s> → nu <b>${time}</b><br>${formatDiff(record.prevMine - game.elapsed)} snabbare! 🚀`
          : `Din första tid: <b>${time}</b> 🚀`;
      const line = record.kind === 'all'
        ? `🏆 Snabbast av alla på ${where}!`
        : record.kind === 'first'
          ? `🎉 Första gången du klarar ${where}!`
          : record.kind === 'first-clean'
            ? `🎉 Din första tid utan ledtrådar – nu är du med på topplistan!`
            : record.kind === 'hinted'
              ? '💡 Klara den utan ledtrådar för att komma med på topplistan!'
              : '';
      $('#win-stars').innerHTML = [1, 2, 3]
        .map((n) => `<span class="${n <= stars ? '' : 'off'}" style="animation-delay:${0.3 + n * 0.2}s">⭐</span>`)
        .join('');
      $('#win-record').hidden = !line;
      $('#win-record').textContent = line;
      $('#win-info').textContent =
        `${who}${modeName(game)} · ${lvl.icon} ${lvl.label} · ⏱ ${time}` +
        (game.hints ? ` · 💡 ${game.hints} ${game.hints > 1 ? 'ledtrådar' : 'ledtråd'}` : ' · inga ledtrådar!');
      $('#win').hidden = false;
      $('#btn-again').focus();
    }, reduceMotion ? 0 : 900);
  }

  /* ---------------- Keyboard ---------------- */

  function onKey(e) {
    if (!game || $('#game').hidden) return;
    if (!$('#win').hidden) return;
    const G = geo();
    const key = e.key;
    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const digitKey = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    if (e.shiftKey && digitKey && Number(digitKey[1]) <= G.digits) {
      enterNote(Number(digitKey[1]));
    } else if (/^[1-9]$/.test(key) && Number(key) <= G.digits) {
      enter(Number(key));
    } else if (key === 'Backspace' || key === 'Delete' || key === '0') {
      erase();
    } else if (key.startsWith('Arrow')) {
      e.preventDefault();
      if (selected < 0) {
        select(0);
        return;
      }
      let r = Math.floor(selected / G.width);
      let c = selected % G.width;
      if (key === 'ArrowUp') r = (r + G.height - 1) % G.height;
      if (key === 'ArrowDown') r = (r + 1) % G.height;
      if (key === 'ArrowLeft') c = (c + G.width - 1) % G.width;
      if (key === 'ArrowRight') c = (c + 1) % G.width;
      select(r * G.width + c);
    } else if (key.toLowerCase() === 'k' || key.toLowerCase() === 'c') {
      check();
    } else if (key.toLowerCase() === 'l' || key.toLowerCase() === 'h') {
      hint();
    } else if (key === 'Escape') {
      selected = -1;
      renderHighlights();
    }
  }

  /* ---------------- Wiring ---------------- */

  function renderSoundButton() {
    const btn = $('#btn-sound');
    btn.textContent = prefs.sound ? '🔊' : '🔇';
    btn.setAttribute('aria-label', prefs.sound ? 'Ljud på' : 'Ljud av');
  }

  function init() {
    migrateOldSave();
    applyTheme();
    buildPlayers();
    document.querySelectorAll('[data-preview]').forEach((el) =>
      el.dataset.preview === 'tectonic' ? buildTectonicPreview(el) : buildPreview(el, S.VARIANTS[el.dataset.preview])
    );

    document.querySelectorAll('.mode-card').forEach((card) =>
      card.addEventListener('click', () => {
        prefs.mode = card.dataset.mode;
        lbMode = prefs.mode;
        savePrefs();
        renderHome();
        burst(card, 6);
      })
    );
    document.querySelectorAll('.level').forEach((btn) =>
      btn.addEventListener('click', () => newGame(prefs.mode, btn.dataset.level, prefs.player))
    );
    document.querySelectorAll('.lb-tab').forEach((tab) =>
      tab.addEventListener('click', () => {
        lbMode = tab.dataset.mode;
        renderLeaderboard();
      })
    );
    window.addEventListener('online', refreshLeaderboard);
    // Tapping an avatar shows that player's top 5; tapping it again shows everyone's.
    $('#lb-levels').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-player]');
      if (!btn) return;
      lbPlayer = lbPlayer === btn.dataset.player ? null : btn.dataset.player;
      renderLeaderboard();
    });
    $('#picker-close').addEventListener('click', closePicker);
    $('#btn-theme').addEventListener('click', openThemePicker);
    $('#theme-close').addEventListener('click', () => ($('#theme-picker').hidden = true));
    $('#theme-picker').addEventListener('click', (e) => {
      if (e.target.id === 'theme-picker') $('#theme-picker').hidden = true;
    });
    $('#avatar-picker').addEventListener('click', (e) => {
      if (e.target.id === 'avatar-picker') closePicker(); // tap outside the card
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#avatar-picker').hidden) closePicker();
      if (e.key === 'Escape') $('#theme-picker').hidden = true;
    });
    $('#continue').addEventListener('click', () => {
      const latest = savedGames()[0];
      if (latest) resumeGame(latest.id);
    });
    $('#btn-games').addEventListener('click', openGamesList);
    $('#games-close').addEventListener('click', () => ($('#games-picker').hidden = true));
    $('#games-picker').addEventListener('click', (e) => {
      if (e.target.id === 'games-picker') $('#games-picker').hidden = true;
      const open = e.target.closest('.saved-open');
      if (open) resumeGame(open.dataset.id);
      const del = e.target.closest('.saved-delete');
      if (del) {
        // First tap asks, second tap removes.
        if (!del.classList.contains('confirm')) {
          del.classList.add('confirm');
          del.textContent = 'Ta bort?';
          return;
        }
        deleteSavedGame(del.dataset.id);
        renderHome();
        if (savedGames().length) openGamesList();
        else $('#games-picker').hidden = true;
      }
    });

    $('#btn-home').addEventListener('click', showHome);
    $('#btn-sound').addEventListener('click', () => {
      prefs.sound = !prefs.sound;
      savePrefs();
      renderSoundButton();
    });
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-erase').addEventListener('click', erase);
    $('#btn-hint').addEventListener('click', hint);
    $('#btn-check').addEventListener('click', check);
    $('#btn-again').addEventListener('click', () => newGame(game.mode, game.level, game.player || prefs.player));
    $('#btn-win-home').addEventListener('click', showHome);

    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', () => {
      if (!game || game.done) return;
      if (document.hidden) saveGame();
      else clockStart = Date.now();
    });

    renderSoundButton();
    renderHome();
    refreshLeaderboard();
  }

  init();
})();
