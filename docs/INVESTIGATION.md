# Investigation: Sudoku logic, templates and layout

This document collects the research done before implementing the app, and
the decisions that came out of it.

## 1. Sudoku logic

### Rules

A sudoku is an `N × N` grid split into `N` rectangular boxes. Every **row**,
every **column** and every **box** must contain each number `1..N` exactly
once.

| Variant          | Grid  | Box shape                 | Numbers | Typical audience |
| ---------------- | ----- | ------------------------- | ------- | ---------------- |
| Classic          | 9 × 9 | 3 rows × 3 cols (9 boxes) | 1–9     | Older kids, adults |
| Mini (6 × 6)     | 6 × 6 | 2 rows × 3 cols (6 boxes) | 1–6     | Kids ~5–9        |

The rules are identical for both, only the box shape changes. That means a
single engine parametrised by `size`, `boxRows` and `boxCols` handles both.

### Key concepts

* **Peers** – the cells that share a row, column or box with a cell. A value is
  a *candidate* for a cell when no peer already holds it.
* **Unique solution** – a proper puzzle has exactly one solution. The generator
  must verify this, otherwise "check my answer" would mark a legitimately
  different (but valid) answer as wrong.
* **Minimum clues** – 17 for 9 × 9 and 8 for 6 × 6. Real puzzles use more.

### Generating a puzzle

The standard approach (used by most open-source generators) is:

1. **Build a full solution** with randomised backtracking: fill cells one by
   one, trying the numbers in random order, backtracking on dead ends.
2. **Dig holes**: visit the cells in random order and remove each number if the
   puzzle is still acceptable afterwards; otherwise put it back.
3. **Stop** when the target number of clues for the difficulty is reached.

"Still acceptable" is where difficulty is controlled:

* **Uniqueness** is checked with a solver that counts solutions and stops at 2.
  Using bitmasks and "most constrained cell first" (MRV) makes it fast enough
  to run hundreds of times per puzzle in the browser.
* **Human solvability**: clue count alone is a poor difficulty measure. A
  puzzle with many clues can still require advanced tricks. For kids, Easy and
  Medium puzzles are therefore required to be solvable using only the two
  simplest techniques:
  * *Naked single* – a cell has only one possible candidate.
  * *Hidden single* – a number has only one possible spot in a row, column or
    box.

  A puzzle that can be completed with singles alone is automatically unique.
  Hard puzzles only require uniqueness, so they may need guessing / deeper
  reasoning.

### Difficulty levels (clues shown at the start)

| Level  | Mini 6 × 6 | Classic 9 × 9 | Rule for digging                |
| ------ | ---------- | ------------- | ------------------------------- |
| Easy   | 22         | 40            | solvable with singles only      |
| Medium | 17         | 32            | solvable with singles only      |
| Hard   | 13         | 25            | unique solution                 |

(Hard targets may not always be reached exactly; the generator keeps the best
of a few attempts.)

## 2. Existing templates / libraries

| Project | Notes | Fit |
| ------- | ----- | --- |
| [robatron/sudoku.js](https://github.com/robatron/sudoku.js/) | Classic Norvig-style generator/solver, difficulty by clue count | 9 × 9 only, string based |
| [einsitang/sudoku-nodejs](https://github.com/einsitang/sudoku-nodejs) | npm package, five difficulty levels | 9 × 9 only |
| [pocketjoso/sudokuJS](https://github.com/pocketjoso/sudokuJS) | Human-style step solver, board size agnostic (4, 9, 16) | Only square boxes – no 2 × 3 boxes for 6 × 6 |
| [Emanuele Feronato – pure JS generator](https://emanueleferonato.com/2015/06/23/pure-javascript-sudoku-generatorsolver/) | Tutorial-level generator | 9 × 9 only |
| Kids apps (e.g. "Sudoku Fun4Kids", various App Store titles) | 4 × 4 / 6 × 6 grids, big touch targets, colours, no ads, offline | UX inspiration |

**Conclusion:** none of the libraries support 6 × 6 with rectangular 2 × 3
boxes *and* 9 × 9 at the same time, and several are unmaintained. The logic is
small (≈ 250 lines), so the app ships its **own dependency-free engine**
(`js/sudoku.js`) that uses the same proven techniques (random backtracking,
MRV bitmask solution counter, singles-based grading). It is unit tested with
Node's built-in test runner.

The app is plain HTML/CSS/JS with no build step, so it can be opened directly
from disk or hosted on GitHub Pages, works offline and collects no data.

## 3. Layout investigation

### Who uses it and how

* Primary users are **kids**, mostly on **tablets and phones**, often held in
  portrait, sometimes on a laptop.
* Kids have less precise taps → touch targets must be **≥ 44 px**, ideally
  bigger. Mis-taps need a cheap undo.
* Reading ability varies → prefer **icons + short words**, colour coding and
  animation as feedback instead of text.

### Input model options

| Model | Pros | Cons | Verdict |
| ----- | ---- | ---- | ------- |
| Select cell → tap number | Standard in almost all sudoku apps, easy to explain, works with keyboard | Two taps per number | ✅ Chosen |
| Select number → tap cells ("paint") | Fast for placing the same number many times | Confusing mode for young kids | ❌ |
| Drag number onto cell | Tactile | Hard on small screens, fiddly for kids | ❌ |
| Pop-up picker on cell | Close to the finger | Covers neighbouring cells, extra dialog | ❌ |

### Screen structure

Considered layouts:

1. **Board with number pad below (portrait)** – board gets full width, pad is
   in thumb reach. Best for phones/tablets in portrait.
2. **Board with number pad beside it (landscape)** – on wide screens a pad below
   would shrink the board; putting the pad in a column to the right keeps the
   board as large as the screen height allows.
3. Pad above the board – rejected, hand covers the board while choosing.

→ The app uses a **responsive layout**: portrait = stacked (header, board, pad,
actions), landscape = board left, pad + actions right. The board is always a
square sized with `min(width, height)` constraints so it never scrolls.

```
 Portrait                         Landscape
┌──────────────────────┐        ┌──────────────────────────────────┐
│ 🏠  Sudoku Fun  🔊    │        │ 🏠  Sudoku Fun   Mini · Easy  🔊  │
│  Mini · Easy          │        ├──────────────────┬───────────────┤
├──────────────────────┤        │                  │  1   2   3    │
│                      │        │                  │  4   5   6    │
│        BOARD         │        │      BOARD       │               │
│      (square)        │        │     (square)     │ ↶  ⌫  💡      │
│                      │        │                  │  [ ✓ Check ]  │
├──────────────────────┤        └──────────────────┴───────────────┘
│ 1  2  3  4  5  6      │
├──────────────────────┤
│ ↶ Undo ⌫ Erase 💡 Hint│
│     [ ✓ Check ]       │
└──────────────────────┘
```

### Board visuals

* Boxes are drawn as **separate rounded tiles with a bigger gap** between
  them than between cells, so the box structure (especially the 2 × 3 boxes of
  the mini version) is obvious without thick lines.
* **Each number has its own colour** (rainbow palette) on the board and on the
  pad, so kids can match numbers by colour as well as by shape.
* **Given numbers** sit on a tinted background and cannot be changed; numbers
  the child enters are on white and pop in with a small bounce.
* Selecting a cell softly highlights its row, column and box, and outlines all
  cells with the same number – this teaches the rules visually.

### Feedback

* **Check** (any time): every filled-in cell flashes **green** (correct) or
  **red** (wrong, with a small shake) for ~3 seconds, then returns to normal.
  Given numbers and empty cells are not affected.
* **Number used up**: each pad button shows how many of that number are still
  missing. When all `N` copies are on the board the button turns into a gold
  "done" button with a ⭐, bursts a few sparkles, and the matching cells on the
  board do a short wave animation.
* **Solved**: confetti, a celebration card with stars, and "Play again".
* Animations respect `prefers-reduced-motion`. Sounds are short WebAudio
  tones and can be muted.

### Game flow

1. **Start screen** – two big cards: *Mini 6 × 6* and *Classic 9 × 9*, then
   three difficulty buttons (Easy 🐣, Medium 🦊, Hard 🦁). A *Continue*
   button appears if an unfinished game is saved.
2. **Game screen** – as described above, with Home, Undo, Erase, Hint and
   Check.
3. **Win overlay** – confetti + new puzzle / change level.

Progress is saved in `localStorage`, so closing the tab does not lose the
game.

Keyboard support on desktop: arrow keys move, `1`–`9` enter, `Backspace` /
`Delete` / `0` erase, `C` check, `Ctrl+Z` undo.

## 4. Tectonic (Suguru / Kemaru)

### Rules

Tectonic, also sold as Suguru or Kemaru, is played on a grid divided into
irregular **regions** (blocks) of 1 to 5 cells.

1. A region of N cells contains every number from 1 to N exactly once. A
   one-cell region is therefore always 1, and no cell can hold a number larger
   than its region's size.
2. Equal numbers may never touch: not horizontally, vertically **or
   diagonally**, and this also applies across region borders. Every cell has
   up to 8 neighbours.
3. There is no row or column rule.
4. A proper puzzle has exactly one solution.

Sources: [dcode](https://www.dcode.fr/tectonic-solver),
[The Puzzle Labs](https://www.thepuzzlelabs.com/suguru/rules),
[logic-puzzles-online](https://logic-puzzles-online.com/suguru/),
[Puzzolve strategies](https://puzzolve.com/intel/suguru-strategies).

### Solving techniques (used to grade difficulty)

| Level | Technique |
| ----- | --------- |
| 1 | **Naked single**: a cell has one candidate left (after removing numbers used in its region and by its 8 neighbours). |
| 1 | **Hidden single**: a number fits in only one cell of its region. |
| 2 | **Cross-region elimination**: if every possible spot for number d in a region touches cell X (outside that region), X cannot be d. |
| 2 | **Naked pair**: two cells of a region with the same two candidates hold those numbers, so they are removed from the rest of the region and from any cell touching both. |

### Generation

Drawing random regions first and then looking for a solution fails for most
boards larger than 6 × 6: the no-touch rule means every 2 × 2 square holds
four different numbers, and independent region shapes rarely allow that.
The generator therefore builds regions **and** numbers together with a
depth-first search:

1. Pick the most boxed-in free cell and grow a region of a random size
   (weighted towards 4–5 cells) from it.
2. Number the region 1..N in an order where no number touches an equal one.
   A look-ahead rejects numberings that leave a free cell with no possible
   number, or whose smallest possible number is larger than the free area
   it sits in.
3. If the rest of the board cannot be completed, undo the region and try
   another shape (backtracking, with an effort budget).

Clues are then removed one by one while the puzzle stays solvable with the
level's techniques (or, for Svår, stays uniquely solvable).

| Level | Board | Clues | Needs |
| ----- | ----- | ----- | ----- |
| Lätt | 5 × 5 | ~44 % | singles only |
| Mellan | 6 × 6 | ~30 % | singles plus cross-region eliminations and pairs |
| Svår | 7 × 7 | as few as possible | any logic (only uniqueness is guaranteed) |

In 100 puzzles per level every puzzle followed the rules and had exactly one
solution. Generation takes 3–30 ms on average.

### In the app

* The board draws thick lines along region borders and gives regions soft
  alternating tints (none in the grown-up themes).
* Selecting a cell highlights its region and its 8 touching cells, the
  cells that constrain it.
* The number buttons count how many of each number are still missing (the
  number of regions with at least that many cells, minus those placed).
* Notes, check, hints, undo, timer, records, saved games and the leaderboard
  work the same as for sudoku.
