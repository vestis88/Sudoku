/*
 * Sudoku engine: generator, solver and helpers for any rectangular box shape.
 * Classic 9x9 uses 3x3 boxes, Mini 6x6 uses boxes of 2 rows x 3 columns.
 *
 * Grids are flat arrays of length size*size; 0 means empty.
 * Works as a browser global (window.Sudoku) and as a CommonJS module.
 */
(function (root) {
  'use strict';

  const VARIANTS = {
    mini: { id: 'mini', size: 6, boxRows: 2, boxCols: 3 },
    classic: { id: 'classic', size: 9, boxRows: 3, boxCols: 3 },
  };

  // Number of given clues per difficulty, and whether the puzzle must be
  // solvable with naked/hidden singles only (kid friendly logic).
  const DIFFICULTIES = {
    mini: {
      easy: { clues: 22, singles: true },
      medium: { clues: 17, singles: true },
      hard: { clues: 13, singles: false },
    },
    classic: {
      easy: { clues: 40, singles: true },
      medium: { clues: 32, singles: true },
      hard: { clues: 25, singles: false },
    },
  };

  const geometryCache = {};

  function geometry(variant) {
    const key = variant.size + 'x' + variant.boxRows + 'x' + variant.boxCols;
    if (geometryCache[key]) return geometryCache[key];
    const { size, boxRows, boxCols } = variant;
    const cells = size * size;
    const rowOf = new Array(cells);
    const colOf = new Array(cells);
    const boxOf = new Array(cells);
    const units = []; // rows, then columns, then boxes
    for (let i = 0; i < size * 3; i++) units.push([]);
    for (let i = 0; i < cells; i++) {
      const r = Math.floor(i / size);
      const c = i % size;
      const b = Math.floor(r / boxRows) * (size / boxCols) + Math.floor(c / boxCols);
      rowOf[i] = r;
      colOf[i] = c;
      boxOf[i] = b;
      units[r].push(i);
      units[size + c].push(i);
      units[size * 2 + b].push(i);
    }
    const peers = [];
    for (let i = 0; i < cells; i++) {
      const set = new Set([
        ...units[rowOf[i]],
        ...units[size + colOf[i]],
        ...units[size * 2 + boxOf[i]],
      ]);
      set.delete(i);
      peers.push([...set]);
    }
    const g = { size, boxRows, boxCols, cells, rowOf, colOf, boxOf, units, peers, full: (1 << (size + 1)) - 2 };
    geometryCache[key] = g;
    return g;
  }

  function bitCount(x) {
    let n = 0;
    while (x) {
      x &= x - 1;
      n++;
    }
    return n;
  }

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Deterministic PRNG so puzzles can be reproduced from a seed (used in tests).
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

  function candidatesMask(grid, i, g) {
    let used = 0;
    const p = g.peers[i];
    for (let k = 0; k < p.length; k++) used |= 1 << grid[p[k]];
    return g.full & ~used;
  }

  /*
   * Backtracking search that always branches on the most constrained cell.
   * Calls onSolution(grid) for each solution; stops when it returns true.
   */
  function search(grid, g, rand, onSolution) {
    let best = -1;
    let bestMask = 0;
    let bestCount = 99;
    for (let i = 0; i < g.cells; i++) {
      if (grid[i]) continue;
      const mask = candidatesMask(grid, i, g);
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
    for (let v = 1; v <= g.size; v++) if (bestMask & (1 << v)) values.push(v);
    if (rand) shuffle(values, rand);
    for (const v of values) {
      grid[best] = v;
      if (search(grid, g, rand, onSolution)) return true;
    }
    grid[best] = 0;
    return false;
  }

  function countSolutions(puzzle, variant, limit = 2) {
    const g = geometry(variant);
    const grid = puzzle.slice();
    let count = 0;
    search(grid, g, null, () => ++count >= limit);
    return count;
  }

  function solve(puzzle, variant) {
    const g = geometry(variant);
    const grid = puzzle.slice();
    let result = null;
    search(grid, g, null, (s) => {
      result = s.slice();
      return true;
    });
    return result;
  }

  function generateSolution(variant, rand = Math.random) {
    const g = geometry(variant);
    const grid = new Array(g.cells).fill(0);
    let result = null;
    search(grid, g, rand, (s) => {
      result = s.slice();
      return true;
    });
    return result;
  }

  /*
   * Tries to finish the puzzle using only naked singles and hidden singles,
   * the techniques kids learn first. Returns true if that fills the grid.
   */
  function solvableWithSingles(puzzle, variant) {
    const g = geometry(variant);
    const grid = puzzle.slice();
    let empty = grid.filter((v) => !v).length;
    let progress = true;
    while (empty > 0 && progress) {
      progress = false;
      const masks = new Array(g.cells).fill(0);
      for (let i = 0; i < g.cells; i++) {
        if (grid[i]) continue;
        masks[i] = candidatesMask(grid, i, g);
        if (masks[i] === 0) return false;
      }
      // Naked singles
      for (let i = 0; i < g.cells; i++) {
        if (!grid[i] && bitCount(masks[i]) === 1) {
          grid[i] = Math.log2(masks[i]);
          empty--;
          progress = true;
        }
      }
      if (progress) continue;
      // Hidden singles
      for (const unit of g.units) {
        for (let v = 1; v <= g.size; v++) {
          const bit = 1 << v;
          let spot = -1;
          let n = 0;
          let placed = false;
          for (const i of unit) {
            if (grid[i] === v) placed = true;
            else if (!grid[i] && masks[i] & bit) {
              spot = i;
              n++;
            }
          }
          if (!placed && n === 1) {
            grid[spot] = v;
            empty--;
            progress = true;
            break;
          }
        }
        if (progress) break;
      }
    }
    return empty === 0;
  }

  function digHoles(solution, variant, settings, rand) {
    const g = geometry(variant);
    const puzzle = solution.slice();
    let clues = g.cells;
    const order = shuffle([...Array(g.cells).keys()], rand);
    for (const i of order) {
      if (clues <= settings.clues) break;
      const keep = puzzle[i];
      puzzle[i] = 0;
      const ok = settings.singles
        ? solvableWithSingles(puzzle, variant)
        : countSolutions(puzzle, variant, 2) === 1;
      if (ok) clues--;
      else puzzle[i] = keep;
    }
    return { puzzle, clues };
  }

  /*
   * Creates a puzzle. Returns { puzzle, solution, variant, difficulty }.
   * `seed` makes the result reproducible.
   */
  function generate(variantId, difficulty, seed) {
    const variant = VARIANTS[variantId];
    if (!variant) throw new Error('Unknown variant: ' + variantId);
    const settings = DIFFICULTIES[variantId][difficulty];
    if (!settings) throw new Error('Unknown difficulty: ' + difficulty);
    const rand = seed === undefined ? Math.random : mulberry32(seed);
    let best = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const solution = generateSolution(variant, rand);
      const dug = digHoles(solution, variant, settings, rand);
      if (!best || dug.clues < best.clues) best = { ...dug, solution };
      if (dug.clues <= settings.clues) break;
    }
    return { puzzle: best.puzzle, solution: best.solution, variant: variantId, difficulty };
  }

  /* Indices of cells that clash with another cell holding the same value. */
  function conflicts(grid, variant) {
    const g = geometry(variant);
    const out = new Set();
    for (let i = 0; i < g.cells; i++) {
      if (!grid[i]) continue;
      for (const p of g.peers[i]) if (grid[p] === grid[i]) out.add(i);
    }
    return out;
  }

  function isValidSolution(grid, variant) {
    const g = geometry(variant);
    for (const unit of g.units) {
      let mask = 0;
      for (const i of unit) mask |= 1 << grid[i];
      if (mask !== g.full) return false;
    }
    return true;
  }

  const api = {
    VARIANTS,
    DIFFICULTIES,
    geometry,
    generate,
    generateSolution,
    solve,
    countSolutions,
    solvableWithSingles,
    conflicts,
    isValidSolution,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sudoku = api;
})(typeof self !== 'undefined' ? self : this);
