/* Sudoku Fun – user interface. Game rules live in sudoku.js. */
(function () {
  'use strict';

  const S = window.Sudoku;
  const SAVE_KEY = 'sudoku-fun-save-v1';
  const PREF_KEY = 'sudoku-fun-prefs-v1';
  const CHECK_MS = 3000;
  const LEVELS = {
    easy: { label: 'Lätt', icon: '🐣' },
    medium: { label: 'Mellan', icon: '🦊' },
    hard: { label: 'Svår', icon: '🦁' },
  };
  const MODES = { mini: 'Mini 6×6', classic: 'Klassisk 9×9' };
  // Swedish plural names of the digits, e.g. "Alla femmor".
  const DIGIT_NAMES = ['', 'ettor', 'tvåor', 'treor', 'fyror', 'femmor', 'sexor', 'sjuor', 'åttor', 'nior'];
  const CHEERS = ['Bra jobbat!', 'Grymt!', 'Super!', 'Toppen!', 'Wow!', 'Du är bäst!', 'Fantastiskt!'];
  const SPARKS = ['⭐', '✨', '🌟', '💫', '🎉'];

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

  let game = null;
  let selected = -1;
  let cellEls = [];
  let padEls = {};
  let noteEls = {};
  let doneDigits = new Set();
  let checkTimer = null;
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
    };
  })();

  /* ---------------- Helpers ---------------- */

  function savePrefs() {
    store.set(PREF_KEY, prefs);
  }

  function variant() {
    return S.VARIANTS[game.mode];
  }

  function elapsedMs() {
    return game.elapsed + (Date.now() - clockStart);
  }

  function saveGame() {
    if (!game) return;
    game.elapsed = elapsedMs();
    clockStart = Date.now();
    store.set(SAVE_KEY, game);
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
    if (reduceMotion) return;
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

  function confetti() {
    const canvas = $('#confetti');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colors = ['#ef476f', '#f7801a', '#ffc93c', '#20a75a', '#0fa9c0', '#3a70f5', '#8b5cf6', '#e0409a'];
    const count = reduceMotion ? 40 : 180;
    const pieces = Array.from({ length: count }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120,
      y: innerHeight * 0.45,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 16 - 6,
      size: 6 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      round: Math.random() < 0.3,
    }));
    const start = performance.now();
    function frame(now) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const t = now - start;
      for (const p of pieces) {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - t / 4000);
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      }
      if (t < 4000) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- Home screen ---------------- */

  function buildLogo() {
    const word = 'Sudoku Kul!';
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
    const secs = Math.round(ms / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = String(secs % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function playerLabel(name) {
    const p = PLAYERS[name];
    return p ? `${p.icon} ${p.name}` : '';
  }

  function buildPlayers() {
    const wrap = $('#players');
    LB.PLAYERS.forEach((p) => {
      const btn = document.createElement('button');
      btn.className = 'player-btn';
      btn.setAttribute('role', 'radio');
      btn.dataset.player = p.name;
      btn.style.setProperty('--pc', p.color);
      btn.innerHTML = `<span class="player-icon">${p.icon}</span><span class="player-name">${p.name}</span>`;
      btn.addEventListener('click', () => {
        prefs.player = p.name;
        savePrefs();
        renderHome();
        burst(btn, 6);
      });
      wrap.appendChild(btn);
    });
  }

  function renderHome() {
    document.querySelectorAll('.mode-card').forEach((card) => {
      card.setAttribute('aria-checked', String(card.dataset.mode === prefs.mode));
    });
    document.querySelectorAll('.player-btn').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.player === prefs.player));
    });
    $('.levels').classList.toggle('locked', !prefs.player);
    const saved = store.get(SAVE_KEY);
    const canContinue = saved && !saved.done && S.VARIANTS[saved.mode];
    $('#continue').hidden = !canContinue;
    if (canContinue) {
      const who = saved.player ? `${playerLabel(saved.player)} · ` : '';
      $('#continue-label').textContent = `${who}${MODES[saved.mode]} · ${LEVELS[saved.level].icon} ${LEVELS[saved.level].label}`;
    }
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
    const stats = LB.stats(results.results())[lbMode];
    const medals = ['🥇', '🥈', '🥉'];
    $('#lb-levels').innerHTML = LB.LEVELS.map((level) => {
      const s = stats[level];
      const lvl = LEVELS[level];
      const best = s.best.length
        ? `<ol class="lb-best">${s.best
            .map(
              (r, k) => `<li class="${r.player === prefs.player ? 'me' : ''}" style="--pc:${PLAYERS[r.player].color}">
                <span class="lb-medal">${medals[k]}</span>
                <span class="lb-player">${playerLabel(r.player)}</span>
                <span class="lb-time">${formatTime(r.timeMs)}${r.hints ? `<small title="Ledtrådar">💡${Number(r.hints)}</small>` : ''}</span>
              </li>`
            )
            .join('')}</ol>`
        : '<p class="lb-empty">Ingen har klarat den än – bli först! 🌟</p>';
      const played = LB.PLAYERS.map(
        (p) =>
          `<span class="lb-chip" style="--pc:${p.color}" title="${p.name}: ${s.byPlayer[p.name]} spelade">${p.icon} ${s.byPlayer[p.name]}</span>`
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
    results.sync().then(renderLeaderboard);
  }

  function showHome() {
    if (game && !game.done) saveGame();
    clearChecks();
    document.body.classList.remove('playing');
    $('#game').hidden = true;
    $('#win').hidden = true;
    $('#home').hidden = false;
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
    const g = S.generate(mode, level);
    game = {
      player,
      mode,
      level,
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
    $('#chip').textContent = `${MODES[game.mode]} · ${lvl.icon} ${lvl.label}`;
    buildBoard();
    buildPad();
    doneDigits = new Set();
    updatePad(false);
    saveGame();
  }

  function buildBoard() {
    const v = variant();
    const g = S.geometry(v);
    const board = $('#board');
    board.innerHTML = '';
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
      const cell = document.createElement('button');
      cell.className = 'cell';
      cell.dataset.i = i;
      cell.setAttribute('role', 'gridcell');
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        select(i);
      });
      cell.addEventListener('click', () => select(i)); // keyboard activation
      cellEls.push(cell);
      boxes[g.boxOf[i]].appendChild(cell);
      renderCell(i);
    }
    renderHighlights();
  }

  function buildPad() {
    const v = variant();
    const pad = $('#pad');
    pad.innerHTML = '';
    pad.style.setProperty('--n', v.size);
    pad.style.setProperty('--pad-rows', Math.ceil(v.size / 3));
    const notePad = $('#notes-pad');
    notePad.innerHTML = '';
    notePad.style.setProperty('--n', v.size);
    notePad.style.setProperty('--pad-rows', Math.ceil(v.size / 3));
    padEls = {};
    noteEls = {};
    for (let d = 1; d <= v.size; d++) {
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
    if (count <= 1) return [1, 0.46];
    if (count === 2) return [2, 0.38];
    if (count <= 4) return [2, 0.33];
    return [3, 0.28];
  }

  function renderCell(i) {
    const el = cellEls[i];
    const val = game.values[i];
    const notes = val ? [] : noteDigits(game.notes[i]);
    const g = S.geometry(variant());
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
      `Rad ${g.rowOf[i] + 1}, kolumn ${g.colOf[i] + 1}, ${content}${game.puzzle[i] ? ', låst' : ''}`
    );
  }

  function renderAllCells() {
    for (let i = 0; i < cellEls.length; i++) renderCell(i);
  }

  function renderHighlights() {
    const g = S.geometry(variant());
    const selVal = selected >= 0 ? game.values[selected] : 0;
    for (let i = 0; i < cellEls.length; i++) {
      const el = cellEls[i];
      const related =
        selected >= 0 &&
        i !== selected &&
        (g.rowOf[i] === g.rowOf[selected] || g.colOf[i] === g.colOf[selected] || g.boxOf[i] === g.boxOf[selected]);
      el.classList.toggle('selected', i === selected);
      el.classList.toggle('related', related);
      el.classList.toggle('same', !!selVal && i !== selected && game.values[i] === selVal);
      if (game.notes[i]) {
        el.querySelectorAll('.note').forEach((n) => n.classList.toggle('hl', Number(n.dataset.d) === selVal));
      }
    }
  }

  function countDigits() {
    const counts = new Array(variant().size + 1).fill(0);
    for (const v of game.values) counts[v]++;
    return counts;
  }

  function updatePad(celebrate) {
    const size = variant().size;
    const counts = countDigits();
    for (let d = 1; d <= size; d++) {
      const left = size - counts[d];
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
      for (const p of S.geometry(variant()).peers[i]) {
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

  // Saves the solve time. Returns a record message, or '' if none.
  function recordResult() {
    if (!game.player || game.recorded) return '';
    const before = results.results().filter((r) => r.mode === game.mode && r.level === game.level);
    const best = Math.min(...before.map((r) => r.timeMs));
    const mine = Math.min(...before.filter((r) => r.player === game.player).map((r) => r.timeMs));
    const saved = results.add({
      player: game.player,
      mode: game.mode,
      level: game.level,
      timeMs: game.elapsed,
      hints: game.hints,
    });
    game.recorded = true;
    if (!saved) return '';
    if (game.elapsed < best && before.length) return '🏆 Nytt rekord för alla!';
    if (game.elapsed < mine) return '⭐ Ditt bästa hittills!';
    return '';
  }

  function win() {
    game.done = true;
    game.elapsed = elapsedMs();
    $('#toast').className = 'toast';
    const record = recordResult();
    store.set(SAVE_KEY, game);
    clearChecks();
    selected = -1;
    renderHighlights();
    Sound.win();
    cellEls.forEach((el, i) => {
      el.style.setProperty('--i', i);
      replayAnimation(el, 'rainbow');
    });
    const stars = game.hints === 0 ? 3 : game.hints <= 2 ? 2 : 1;
    const time = formatTime(game.elapsed);
    const lvl = LEVELS[game.level];
    const who = game.player ? `${playerLabel(game.player)} · ` : '';
    setTimeout(() => {
      confetti();
      $('#win-stars').innerHTML = [1, 2, 3]
        .map((n) => `<span class="${n <= stars ? '' : 'off'}" style="animation-delay:${0.3 + n * 0.2}s">⭐</span>`)
        .join('');
      $('#win-record').hidden = !record;
      $('#win-record').textContent = record;
      $('#win-info').textContent =
        `${who}${MODES[game.mode]} · ${lvl.icon} ${lvl.label} · ⏱ ${time}` +
        (game.hints ? ` · 💡 ${game.hints} ${game.hints > 1 ? 'ledtrådar' : 'ledtråd'}` : ' · inga ledtrådar!');
      $('#win').hidden = false;
      $('#btn-again').focus();
    }, reduceMotion ? 0 : 900);
  }

  /* ---------------- Keyboard ---------------- */

  function onKey(e) {
    if (!game || $('#game').hidden) return;
    if (!$('#win').hidden) return;
    const v = variant();
    const key = e.key;
    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const digitKey = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    if (e.shiftKey && digitKey && Number(digitKey[1]) <= v.size) {
      enterNote(Number(digitKey[1]));
    } else if (/^[1-9]$/.test(key) && Number(key) <= v.size) {
      enter(Number(key));
    } else if (key === 'Backspace' || key === 'Delete' || key === '0') {
      erase();
    } else if (key.startsWith('Arrow')) {
      e.preventDefault();
      const g = S.geometry(v);
      if (selected < 0) {
        select(0);
        return;
      }
      let r = g.rowOf[selected];
      let c = g.colOf[selected];
      if (key === 'ArrowUp') r = (r + v.size - 1) % v.size;
      if (key === 'ArrowDown') r = (r + 1) % v.size;
      if (key === 'ArrowLeft') c = (c + v.size - 1) % v.size;
      if (key === 'ArrowRight') c = (c + 1) % v.size;
      select(r * v.size + c);
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
    buildLogo();
    buildPlayers();
    document.querySelectorAll('[data-preview]').forEach((el) => buildPreview(el, S.VARIANTS[el.dataset.preview]));

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
    $('#continue').addEventListener('click', () => {
      const saved = store.get(SAVE_KEY);
      if (!saved) return;
      game = saved;
      startGame();
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
