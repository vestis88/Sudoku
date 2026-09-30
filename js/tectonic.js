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

  // Board size, share of cells shown as clues, and which techniques a
  // player may need: 1 = singles only, 2 = also cross-region eliminations
  // and pairs, 0 = anything (the puzzle is only required to be unique).
  const LEVELS = {
    easy: { width: 5, height: 5, clues: 0.44, logic: 1 },
    medium: { width: 6, height: 6, clues: 0.3, logic: 2 },
    hard: { width: 7, height: 7, clues: 0, logic: 0 },
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
  function buildBoard(width, height, rand) {
    const cells = width * height;
    const regions = new Array(cells).fill(-1);
    const values = new Array(cells).fill(0);
    const free = (i) => regions[i] === -1;
    const freeNeighbours = (i) => orthogonal(i, width, height).filter(free).length;
    const fits = (i, v) => touching(i, width, height).every((n) => values[n] !== v);

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
        const patch = new Array(cells).fill(0);
        for (let i = 0; i < cells; i++) {
          if (!free(i) || patch[i]) continue;
          const stack = [i];
          const members = [];
          patch[i] = -1;
          while (stack.length) {
            const c = stack.pop();
            members.push(c);
            for (const n of orthogonal(c, width, height)) {
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
          for (const t of touching(n, width, height)) if (values[t]) blocked |= 1 << values[t];
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
        for (const c of region) for (const n of orthogonal(c, width, height)) if (free(n) && !frontier.includes(n)) frontier.push(n);
        if (!frontier.length) break;
        shuffle(frontier, rand);
        // Mostly take boxed-in cells first, sometimes any, for varied shapes.
        if (rand() < 0.7) frontier.sort((a, b) => freeNeighbours(a) - freeNeighbours(b));
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
    const budget = { steps: 4000 };
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
    const budget = { nodes: 200000 };
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
   * Solves with the techniques players use, in order of difficulty.
   * level 1: naked singles (one candidate left) and hidden singles (a number
   *          fits in only one cell of its region).
   * level 2: also eliminations across regions (a cell touching every
   *          possible spot of a number in another region cannot hold it)
   *          and naked pairs inside a region.
   * Returns true when the grid gets completely filled.
   */
  function solveLogic(puzzle, geo, level) {
    const grid = puzzle.slice();
    const banned = new Array(geo.cells).fill(0);
    let empty = grid.filter((v) => !v).length;
    const cand = () => grid.map((v, i) => (v ? 0 : candidates(grid, i, geo) & ~banned[i]));

    while (empty > 0) {
      const c = cand();
      let progress = false;

      // Naked singles
      for (let i = 0; i < geo.cells; i++) {
        if (grid[i]) continue;
        if (!c[i]) return false;
        if (bitCount(c[i]) === 1) {
          grid[i] = lowestDigit(c[i]);
          empty--;
          progress = true;
        }
      }
      if (progress) continue;

      // Hidden singles in a region
      for (const unit of geo.units) {
        for (let d = 1; d <= unit.length && !progress; d++) {
          if (unit.some((i) => grid[i] === d)) continue;
          const spots = unit.filter((i) => !grid[i] && c[i] & (1 << d));
          if (spots.length === 0) return false;
          if (spots.length === 1) {
            grid[spots[0]] = d;
            empty--;
            progress = true;
          }
        }
        if (progress) break;
      }
      if (progress || level < 2) {
        if (progress) continue;
        return false;
      }

      // A cell that touches every possible spot of number d in a region
      // (outside that cell's own region) cannot be d.
      for (let u = 0; u < geo.units.length; u++) {
        const unit = geo.units[u];
        for (let d = 1; d <= unit.length; d++) {
          if (unit.some((i) => grid[i] === d)) continue;
          const spots = unit.filter((i) => !grid[i] && c[i] & (1 << d));
          if (!spots.length) continue;
          const common = geo.neighbors[spots[0]].filter(
            (x) => geo.unitOf[x] !== u && spots.every((s) => geo.neighbors[s].includes(x))
          );
          for (const x of common) {
            if (!grid[x] && c[x] & (1 << d) && !(banned[x] & (1 << d))) {
              banned[x] |= 1 << d;
              progress = true;
            }
          }
        }
      }

      // Naked pairs: two cells of a region with the same two candidates hold
      // those numbers, so other cells of the region, and any cell touching
      // both, cannot.
      for (const unit of geo.units) {
        const open = unit.filter((i) => !grid[i]);
        for (let a = 0; a < open.length; a++) {
          for (let b = a + 1; b < open.length; b++) {
            const p = open[a];
            const q = open[b];
            if (c[p] !== c[q] || bitCount(c[p]) !== 2) continue;
            const targets = new Set(open.filter((x) => x !== p && x !== q));
            geo.neighbors[p].forEach((x) => geo.neighbors[q].includes(x) && x !== p && x !== q && targets.add(x));
            for (const x of targets) {
              if (!grid[x] && c[x] & c[p] & ~banned[x]) {
                banned[x] |= c[p];
                progress = true;
              }
            }
          }
        }
      }
      if (!progress) return false;
    }
    return true;
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
      const ok = settings.logic ? solveLogic(puzzle, geo, settings.logic) : countSolutions(puzzle, geo, 2) === 1;
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
    for (let attempt = 0; attempt < 200; attempt++) {
      const board = buildBoard(width, height, rand);
      if (!board) continue;
      const { regions, solution } = board;
      const geo = geometry(width, height, regions);
      if (!acceptableRegions(geo)) continue;
      const puzzle = digClues(solution, geo, settings, rand);
      return { width, height, regions, puzzle, solution };
    }
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
