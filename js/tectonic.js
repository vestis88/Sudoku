/*
 * Tectonic (also called Suguru or Kemaru) engine: generator, solver and
 * human-style grader.
 *
 * Rules:
 *  1. The grid is divided into regions of 1 to 5 cells.
 *  2. A region of N cells contains every number 1..N exactly once.
 *  3. Equal numbers never touch, not even diagonally (also across regions).
 *  There is no row or column rule. A proper puzzle has exactly one solution.
 *
 * Grids are flat arrays (row-major, width x height); 0 means empty.
 * `regions` holds a region id for every cell.
 * Works as a browser global (window.Tectonic) and as a CommonJS module.
 */
(function (root) {
  'use strict';

  const MAX_REGION = 5;

  /*
   * All levels use a 9 x 9 board; they differ in the techniques needed
   * (see runLogic): `logic` is the highest tier allowed, `harder` means the
   * puzzle must NOT be solvable with that lower tier, and `clues` keeps at
   * least that share of the cells filled in (0 = remove as many as possible).
   */
  const LEVELS = {
    easy: { width: 9, height: 9, logic: 1, harder: 0, clues: 0.4 },
    medium: { width: 9, height: 9, logic: 2, harder: 1, clues: 0 },
    hard: { width: 9, height: 9, logic: 3, harder: 2, clues: 0 },
  };

  const WEIGHTS = [
    [5, 0.4],
    [4, 0.3],
    [3, 0.17],
    [2, 0.08],
    [1, 0.05],
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function bitCount(x) {
    let n = 0;
    while (x) {
      x &= x - 1;
      n++;
    }
    return n;
  }

  function lowestDigit(mask) {
    for (let d = 1; d <= 9; d++) if (mask & (1 << d)) return d;
    return 0;
  }

  /* ---------- Geometry ---------- */

  function orthogonal(i, w, h) {
    const r = Math.floor(i / w);
    const c = i % w;
    const out = [];
    if (r > 0) out.push(i - w);
    if (r < h - 1) out.push(i + w);
    if (c > 0) out.push(i - 1);
    if (c < w - 1) out.push(i + 1);
    return out;
  }

  function touching(i, w, h) {
    const r = Math.floor(i / w);
    const c = i % w;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < h && cc >= 0 && cc < w) out.push(rr * w + cc);
      }
    }
    return out;
  }

  /*
   * Everything the solver and the UI need about one board:
   * regions as cell lists, region size per cell, the 8 touching cells and
   * all "peers" (same region or touching) per cell.
   */
  function geometry(width, height, regions) {
    const cells = width * height;
    const groups = [];
    regions.forEach((id, i) => (groups[id] = groups[id] || []).push(i));
    const units = groups.filter(Boolean);
    const unitOf = new Array(cells);
    units.forEach((u, k) => u.forEach((i) => (unitOf[i] = k)));
    const sizeOf = Array.from({ length: cells }, (_, i) => units[unitOf[i]].length);
    const neighbors = Array.from({ length: cells }, (_, i) => touching(i, width, height));
    const peers = Array.from({ length: cells }, (_, i) => {
      const set = new Set(units[unitOf[i]].concat(neighbors[i]));
      set.delete(i);
      return [...set];
    });
    const digits = Math.max(...sizeOf);
    // How many times each number appears in a solved grid
    const needed = new Array(digits + 1).fill(0);
    units.forEach((u) => {
      for (let d = 1; d <= u.length; d++) needed[d]++;
    });
    return { width, height, cells, units, unitOf, sizeOf, neighbors, peers, digits, needed };
  }

  /* ---------- Regions ---------- */

  function pickSize(rand) {
    let x = rand();
    for (const [size, weight] of WEIGHTS) {
      if ((x -= weight) <= 0) return size;
    }
    return MAX_REGION;
  }

  /*
   * Draws regions and numbers them at the same time, so every layout is
   * solvable by construction: each new region gets the numbers 1..N in an
   * order where no number touches an equal, already placed number.
   * Returns { regions, solution } or null when it paints itself into a corner.
   */
  const adjacencyCache = {};
  function adjacency(width, height) {
    const key = width + 'x' + height;
    if (!adjacencyCache[key]) {
      const cells = width * height;
      adjacencyCache[key] = {
        orth: Array.from({ length: cells }, (_, i) => orthogonal(i, width, height)),
        touch: Array.from({ length: cells }, (_, i) => touching(i, width, height)),
      };
    }
    return adjacencyCache[key];
  }

  function buildBoard(width, height, rand) {
    const cells = width * height;
    const { orth, touch } = adjacency(width, height);
    const regions = new Array(cells).fill(-1);
    const values = new Array(cells).fill(0);
    const free = (i) => regions[i] === -1;
    const freeNeighbours = (i) => {
      let n = 0;
      for (const x of orth[i]) if (regions[x] === -1) n++;
      return n;
    };
    const fits = (i, v) => {
      for (const n of touch[i]) if (values[n] === v) return false;
      return true;
    };

    // A random order of 1..k over the region's cells that respects the
    // numbers already placed around it.
    function number(region) {
      const k = region.length;
      const order = shuffle([...Array(k).keys()].map((x) => x + 1), rand);
      const used = new Array(k + 1).fill(false);
      const out = new Array(k);
      // Look one step ahead: every empty cell next to the region must still
      // have a number it could take, and a boxed-in cell (it will become a
      // region of one) must still be allowed a 1.
      // A future region can only use the empty patch a cell sits in (its
      // orthogonally connected empty area), so each empty cell's smallest
      // still-allowed number must fit in that patch.
      function stillOpen() {
        const patch = new Int8Array(cells);
        for (let i = 0; i < cells; i++) {
          if (!free(i) || patch[i]) continue;
          const stack = [i];
          const members = [];
          patch[i] = -1;
          while (stack.length) {
            const c = stack.pop();
            members.push(c);
            for (const n of orth[c]) {
              if (free(n) && !patch[n]) {
                patch[n] = -1;
                stack.push(n);
              }
            }
          }
          members.forEach((c) => (patch[c] = Math.min(members.length, MAX_REGION)));
        }
        for (let n = 0; n < cells; n++) {
          if (!free(n)) continue;
          let blocked = 0;
          for (const t of touch[n]) if (values[t]) blocked |= 1 << values[t];
          let smallest = 0;
          for (let d = 1; d <= MAX_REGION && !smallest; d++) if (!(blocked & (1 << d))) smallest = d;
          if (!smallest || smallest > patch[n]) return false;
        }
        return true;
      }
      function place(j) {
        if (j === k) return stillOpen();
        for (const v of order) {
          if (used[v] || !fits(region[j], v)) continue;
          used[v] = true;
          out[j] = v;
          values[region[j]] = v; // so later cells of this region see it
          if (place(j + 1)) return true;
          values[region[j]] = 0;
          used[v] = false;
        }
        return false;
      }
      return place(0) ? out : null;
    }

    // Grow shape for a new region from `start`, trying to reach `target` cells.
    function grow(start, target, id) {
      const region = [start];
      regions[start] = id;
      while (region.length < target) {
        const frontier = [];
        for (const c of region) for (const n of orth[c]) if (free(n) && !frontier.includes(n)) frontier.push(n);
        if (!frontier.length) break;
        shuffle(frontier, rand);
        // Mostly take boxed-in cells first, sometimes any, for varied shapes.
        if (rand() < 0.7) {
          const f = new Map(frontier.map((x) => [x, freeNeighbours(x)]));
          frontier.sort((a, b) => f.get(a) - f.get(b));
        }
        regions[frontier[0]] = id;
        region.push(frontier[0]);
      }
      return region;
    }

    function clear(region) {
      region.forEach((c) => {
        regions[c] = -1;
        values[c] = 0;
      });
    }

    // Depth-first: place one region at a time and undo it when the rest of
    // the board cannot be completed. `budget` caps the total effort.
    const budget = { steps: 3000 };
    function step(id) {
      if (budget.steps-- <= 0) return false;
      let start = -1;
      let best = 9;
      for (const i of shuffle([...Array(cells).keys()], rand)) {
        if (!free(i)) continue;
        const n = freeNeighbours(i);
        if (n < best) {
          best = n;
          start = i;
        }
      }
      if (start === -1) return true; // every cell is in a region
      for (let tries = 0; tries < 6; tries++) {
        const region = grow(start, pickSize(rand), id);
        if (number(region) && step(id + 1)) return true;
        clear(region);
        if (budget.steps <= 0) return false;
      }
      return false;
    }

    if (!step(0)) return null;
    return { regions, solution: values };
  }

  function acceptableRegions(geo) {
    const singles = geo.units.filter((u) => u.length === 1).length;
    const big = geo.units.filter((u) => u.length >= 4).length;
    return singles <= Math.max(1, Math.floor(geo.cells / 16)) && big >= geo.units.length / 3;
  }

  /* ---------- Search (fill and count solutions) ---------- */

  function candidates(grid, i, geo) {
    let mask = (1 << (geo.sizeOf[i] + 1)) - 2;
    for (const p of geo.peers[i]) if (grid[p]) mask &= ~(1 << grid[p]);
    return mask;
  }

  // Backtracking on the most constrained cell. onSolution returns true to stop.
  function search(grid, geo, rand, onSolution, budget) {
    if (budget.nodes-- <= 0) return true;
    let best = -1;
    let bestMask = 0;
    let bestCount = 99;
    for (let i = 0; i < geo.cells; i++) {
      if (grid[i]) continue;
      const mask = candidates(grid, i, geo);
      const n = bitCount(mask);
      if (n === 0) return false;
      if (n < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = n;
        if (n === 1) break;
      }
    }
    if (best === -1) return onSolution(grid);
    const values = [];
    for (let d = 1; d <= MAX_REGION; d++) if (bestMask & (1 << d)) values.push(d);
    if (rand) shuffle(values, rand);
    for (const v of values) {
      grid[best] = v;
      if (search(grid, geo, rand, onSolution, budget)) return true;
    }
    grid[best] = 0;
    return false;
  }

  function countSolutions(puzzle, geo, limit = 2) {
    const grid = puzzle.slice();
    let count = 0;
    const budget = { nodes: 5000000 };
    search(grid, geo, null, () => ++count >= limit, budget);
    return budget.nodes <= 0 ? limit : count; // treat an exhausted search as "not unique"
  }

  function solve(puzzle, geo) {
    const grid = puzzle.slice();
    let result = null;
    search(grid, geo, null, (s) => ((result = s.slice()), true), { nodes: 500000 });
    return result;
  }

  /* ---------- Human-style solver used for grading ---------- */

  /*
   * Solves with the techniques players use, in tiers:
   *  1  naked single (one candidate left) and hidden single (a number fits
   *     in only one cell of its region). Candidates already exclude numbers
   *     used in the region and by the 8 touching cells.
   *  2  forbidden neighbour (a cell touching every possible spot of a number
   *     in another region cannot hold it), naked pairs and hidden pairs.
   *  3  naked triples, and "what if" on cells with two candidates: if trying
   *     one of them leads to a contradiction with tier 2, it is the other.
   * Mutates grid and banned; returns 'solved', 'stuck' or 'contradiction'.
   */
  function runLogic(grid, banned, geo, level) {
    const full = (i) => (1 << (geo.sizeOf[i] + 1)) - 2;
    for (;;) {
      let empty = 0;
      const c = new Array(geo.cells).fill(0);
      for (let i = 0; i < geo.cells; i++) {
        if (grid[i]) continue;
        empty++;
        c[i] = candidates(grid, i, geo) & ~banned[i] & full(i);
        if (!c[i]) return 'contradiction';
      }
      if (!empty) return 'solved';
      const place = (i, d) => {
        grid[i] = d;
        return true;
      };
      const ban = (i, mask) => {
        if (grid[i] || !(c[i] & mask & ~banned[i])) return false;
        banned[i] |= mask;
        return true;
      };

      // Tier 1: naked singles. One at a time, because the candidates must be
      // recomputed after each placement.
      let progress = false;
      for (let i = 0; i < geo.cells && !progress; i++) if (!grid[i] && bitCount(c[i]) === 1) progress = place(i, lowestDigit(c[i]));
      if (progress) continue;

      // Tier 1: hidden singles (and a region that has lost a number is broken)
      for (const unit of geo.units) {
        for (let d = 1; d <= unit.length; d++) {
          if (unit.some((i) => grid[i] === d)) continue;
          const spots = unit.filter((i) => !grid[i] && c[i] & (1 << d));
          if (!spots.length) return 'contradiction';
          if (spots.length === 1) {
            place(spots[0], d);
            progress = true;
            break;
          }
        }
        if (progress) break;
      }
      if (progress) continue;
      if (level < 2) return 'stuck';

      // Tier 2: forbidden neighbour
      geo.units.forEach((unit, u) => {
        for (let d = 1; d <= unit.length; d++) {
          if (unit.some((i) => grid[i] === d)) continue;
          const spots = unit.filter((i) => !grid[i] && c[i] & (1 << d));
          if (!spots.length) continue;
          for (const x of geo.neighbors[spots[0]]) {
            if (geo.unitOf[x] !== u && spots.every((sp) => geo.neighbors[sp].includes(x))) progress = ban(x, 1 << d) || progress;
          }
        }
      });
      if (progress) continue;

      // Tier 2: naked pairs (also clears cells touching both)
      for (const unit of geo.units) {
        const open = unit.filter((i) => !grid[i]);
        for (let a = 0; a < open.length; a++) {
          for (let b = a + 1; b < open.length; b++) {
            const p = open[a];
            const q = open[b];
            if (c[p] !== c[q] || bitCount(c[p]) !== 2) continue;
            for (const x of open) if (x !== p && x !== q) progress = ban(x, c[p]) || progress;
            for (const x of geo.neighbors[p]) if (x !== q && geo.neighbors[q].includes(x)) progress = ban(x, c[p]) || progress;
          }
        }
      }
      if (progress) continue;

      // Tier 2: hidden pairs (two numbers that fit only in the same two cells)
      for (const unit of geo.units) {
        const spotsOf = [];
        for (let d = 1; d <= unit.length; d++) {
          if (unit.some((i) => grid[i] === d)) continue;
          spotsOf.push([d, unit.filter((i) => !grid[i] && c[i] & (1 << d))]);
        }
        for (let a = 0; a < spotsOf.length; a++) {
          for (let b = a + 1; b < spotsOf.length; b++) {
            const [da, sa] = spotsOf[a];
            const [db, sb] = spotsOf[b];
            if (sa.length !== 2 || sb.length !== 2 || sa[0] !== sb[0] || sa[1] !== sb[1]) continue;
            const keep = (1 << da) | (1 << db);
            for (const x of sa) progress = ban(x, c[x] & ~keep) || progress;
          }
        }
      }
      if (progress) continue;
      if (level < 3) return 'stuck';

      // Tier 3: naked triples in a region
      for (const unit of geo.units) {
        const open = unit.filter((i) => !grid[i] && bitCount(c[i]) <= 3);
        for (let a = 0; a < open.length; a++)
          for (let b = a + 1; b < open.length; b++)
            for (let e = b + 1; e < open.length; e++) {
              const mask = c[open[a]] | c[open[b]] | c[open[e]];
              if (bitCount(mask) !== 3) continue;
              const trio = [open[a], open[b], open[e]];
              for (const x of unit) if (!trio.includes(x)) progress = ban(x, mask) || progress;
            }
      }
      if (progress) continue;

      // Tier 3: "what if" on two-candidate cells
      for (let i = 0; i < geo.cells && !progress; i++) {
        if (grid[i] || bitCount(c[i]) !== 2) continue;
        for (let d = 1; d <= MAX_REGION; d++) {
          if (!(c[i] & (1 << d))) continue;
          const g2 = grid.slice();
          g2[i] = d;
          if (runLogic(g2, banned.slice(), geo, 2) === 'contradiction') {
            progress = ban(i, 1 << d);
            break;
          }
        }
      }
      if (!progress) return 'stuck';
    }
  }

  // True when the puzzle can be finished using techniques up to `level`.
  function solveLogic(puzzle, geo, level) {
    return runLogic(puzzle.slice(), new Array(geo.cells).fill(0), geo, level) === 'solved';
  }

  /* ---------- Puzzle generation ---------- */

  function digClues(solution, geo, settings, rand) {
    const puzzle = solution.slice();
    const target = Math.round(geo.cells * settings.clues);
    let clues = geo.cells;
    for (const i of shuffle([...Array(geo.cells).keys()], rand)) {
      if (clues <= target) break;
      const keep = puzzle[i];
      puzzle[i] = 0;
      const ok = solveLogic(puzzle, geo, settings.logic);
      if (ok) clues--;
      else puzzle[i] = keep;
    }
    return puzzle;
  }

  /*
   * Creates a puzzle for 'easy', 'medium' or 'hard'.
   * Returns { width, height, regions, puzzle, solution }.
   */
  function generate(level, seed) {
    const settings = LEVELS[level];
    if (!settings) throw new Error('Unknown difficulty: ' + level);
    const rand = seed === undefined ? Math.random : mulberry32(seed);
    const { width, height } = settings;
    let fallback = null;
    for (let attempt = 0; attempt < 400; attempt++) {
      const board = buildBoard(width, height, rand);
      if (!board) continue;
      const { regions, solution } = board;
      const geo = geometry(width, height, regions);
      if (!acceptableRegions(geo)) continue;
      const puzzle = digClues(solution, geo, settings, rand);
      const result = { width, height, regions, puzzle, solution };
      // Too easy for this level? Try another board (keep one just in case).
      if (settings.harder && solveLogic(puzzle, geo, settings.harder)) {
        fallback = fallback || result;
        if (attempt < 60) continue;
        return fallback;
      }
      return result;
    }
    if (fallback) return fallback;
    throw new Error('Could not generate a Tectonic puzzle');
  }

  function isValidSolution(grid, geo) {
    for (const unit of geo.units) {
      const seen = new Set(unit.map((i) => grid[i]));
      for (let d = 1; d <= unit.length; d++) if (!seen.has(d)) return false;
    }
    for (let i = 0; i < geo.cells; i++) {
      if (grid[i] < 1 || grid[i] > geo.sizeOf[i]) return false;
      if (geo.neighbors[i].some((n) => grid[n] === grid[i])) return false;
    }
    return true;
  }

  const api = { LEVELS, MAX_REGION, geometry, generate, solve, countSolutions, solveLogic, isValidSolution };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tectonic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
