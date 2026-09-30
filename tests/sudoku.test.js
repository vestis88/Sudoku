const test = require('node:test');
const assert = require('node:assert/strict');
const Sudoku = require('../js/sudoku.js');

for (const variantId of ['mini', 'classic']) {
  const variant = Sudoku.VARIANTS[variantId];

  test(`${variantId}: geometry has correct units and peers`, () => {
    const g = Sudoku.geometry(variant);
    assert.equal(g.units.length, variant.size * 3);
    for (const unit of g.units) assert.equal(unit.length, variant.size);
    const expectedPeers = 2 * (variant.size - 1) + (variant.size - variant.boxRows - variant.boxCols + 1);
    for (const p of g.peers) assert.equal(p.length, expectedPeers);
  });

  test(`${variantId}: generated solution is valid`, () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { solution } = Sudoku.generate(variantId, 'easy', seed);
      assert.ok(Sudoku.isValidSolution(solution, variant));
    }
  });

  for (const difficulty of ['easy', 'medium', 'hard']) {
    test(`${variantId} ${difficulty}: puzzles are unique and match their solution`, () => {
      const settings = Sudoku.DIFFICULTIES[variantId][difficulty];
      for (let seed = 1; seed <= 5; seed++) {
        const { puzzle, solution } = Sudoku.generate(variantId, difficulty, seed);
        puzzle.forEach((v, i) => {
          if (v) assert.equal(v, solution[i]);
        });
        assert.equal(Sudoku.countSolutions(puzzle, variant, 2), 1);
        assert.deepEqual(Sudoku.solve(puzzle, variant), solution);
        const clues = puzzle.filter(Boolean).length;
        // Hard targets are best effort; allow a small margin.
        assert.ok(clues <= settings.clues + (settings.singles ? 0 : 4), `clues ${clues}`);
        if (settings.singles) assert.ok(Sudoku.solvableWithSingles(puzzle, variant));
      }
    });
  }
}

test('difficulty ordering: harder levels give fewer clues', () => {
  for (const variantId of ['mini', 'classic']) {
    const count = (d) => Sudoku.generate(variantId, d, 42).puzzle.filter(Boolean).length;
    assert.ok(count('easy') > count('medium'));
    assert.ok(count('medium') > count('hard'));
  }
});

test('conflicts finds duplicates in row, column and box', () => {
  const v = Sudoku.VARIANTS.mini;
  const grid = new Array(36).fill(0);
  grid[0] = 3;
  grid[4] = 3; // same row
  grid[30] = 5;
  grid[35] = 1;
  assert.deepEqual([...Sudoku.conflicts(grid, v)].sort((a, b) => a - b), [0, 4]);
  grid[4] = 0;
  grid[7] = 3; // same 2x3 box as 0
  assert.deepEqual([...Sudoku.conflicts(grid, v)].sort((a, b) => a - b), [0, 7]);
});

test('unknown variant or difficulty throws', () => {
  assert.throws(() => Sudoku.generate('huge', 'easy'));
  assert.throws(() => Sudoku.generate('mini', 'impossible'));
});
