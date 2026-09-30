const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/tectonic.js');

function checkRules(p) {
  const geo = T.geometry(p.width, p.height, p.regions);
  // Rule 1: regions are 1..5 cells and orthogonally connected
  for (const unit of geo.units) {
    assert.ok(unit.length >= 1 && unit.length <= T.MAX_REGION, `region size ${unit.length}`);
    const seen = new Set([unit[0]]);
    const stack = [unit[0]];
    while (stack.length) {
      const c = stack.pop();
      const r = Math.floor(c / p.width);
      const col = c % p.width;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr;
        const cc = col + dc;
        const n = rr * p.width + cc;
        if (rr >= 0 && rr < p.height && cc >= 0 && cc < p.width && unit.includes(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    assert.equal(seen.size, unit.length, 'region is connected');
    // Rule 2: a region of N cells holds 1..N exactly once
    assert.deepEqual(unit.map((i) => p.solution[i]).sort(), [...Array(unit.length).keys()].map((x) => x + 1));
  }
  // Rule 3: equal numbers never touch, not even diagonally
  for (let i = 0; i < geo.cells; i++) {
    for (const n of geo.neighbors[i]) assert.notEqual(p.solution[i], p.solution[n], `cells ${i} and ${n} touch`);
  }
  return geo;
}

for (const level of ['easy', 'medium', 'hard']) {
  test(`${level}: puzzles follow the rules and have exactly one solution`, () => {
    const settings = T.LEVELS[level];
    for (let seed = 1; seed <= 15; seed++) {
      const p = T.generate(level, seed);
      assert.equal(p.width, settings.width);
      assert.equal(p.height, settings.height);
      const geo = checkRules(p);
      assert.ok(T.isValidSolution(p.solution, geo));
      p.puzzle.forEach((v, i) => v && assert.equal(v, p.solution[i]));
      assert.equal(T.countSolutions(p.puzzle, geo, 2), 1);
      assert.deepEqual(T.solve(p.puzzle, geo), p.solution);
      if (settings.logic) assert.ok(T.solveLogic(p.puzzle, geo, settings.logic), 'solvable with the allowed techniques');
    }
  });
}

test('the same seed gives the same puzzle', () => {
  assert.deepEqual(T.generate('medium', 42), T.generate('medium', 42));
});

test('geometry: region sizes, touching cells and how many of each number', () => {
  // 2x3 board: region 0 = left column (2 cells), region 1 = the rest (4 cells)
  //  0 1 1
  //  0 1 1
  const geo = T.geometry(3, 2, [0, 1, 1, 0, 1, 1]);
  assert.deepEqual(geo.sizeOf, [2, 4, 4, 2, 4, 4]);
  assert.deepEqual(geo.neighbors[0].sort(), [1, 3, 4]);
  assert.equal(geo.neighbors[4].length, 5);
  assert.equal(geo.digits, 4);
  assert.deepEqual(geo.needed, [0, 2, 2, 1, 1]);
});

test('the logic solver uses the region and no-touch rules', () => {
  // One 5-cell region in a row plus a single cell below its middle.
  //  A A A A A
  //  . . B . .   (B is a region of one, so it must be 1)
  const regions = [0, 0, 0, 0, 0, 2, 3, 1, 4, 5];
  const geo = T.geometry(5, 2, regions);
  assert.equal(geo.sizeOf[7], 1);
  // Row 2 cells other than B are single regions too, which must all be 1 but
  // would touch each other: no solution.
  assert.equal(T.countSolutions(new Array(10).fill(0), geo, 2), 0);
});

test('isValidSolution rejects touching equal numbers', () => {
  const geo = T.geometry(2, 1, [0, 1]); // two single-cell regions side by side
  assert.equal(T.isValidSolution([1, 1], geo), false);
});
