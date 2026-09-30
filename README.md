# Sudoku Fun 🧩

A colourful, animated sudoku game for kids, in Swedish ("Sudoku Kul"). Plain HTML, CSS and JavaScript:
no build step, no dependencies, works offline and collects no data.

## Features

* **Two board sizes**
  * **Mini 6 × 6**: numbers 1–6 in boxes of 2 rows × 3 columns. Good for younger kids.
  * **Classic 9 × 9**: numbers 1–9 in 3 × 3 boxes.
* **Three levels**: Easy 🐣, Medium 🦊 and Hard 🦁. Easy and Medium puzzles can
  always be solved with simple logic, without guessing. Every puzzle has
  exactly one solution.
* **Check at any time**: every number you entered turns **green** (right) or
  **red** (wrong) for 3 seconds.
* **Numbers used up**: each number button shows how many are left. When all of
  one number are on the board, its button turns gold with a ⭐, sparkles fly and
  the numbers on the board do a wave.
* **Notes**: a second row of small outlined ✏️ buttons adds possible
  candidates; the big buttons enter answers. Notes are small, italic and
  shrink as more are added.
  Entering an answer replaces the notes in that square and removes that number
  from the notes in the same row, column and box.
* Undo, erase, hints, confetti when you win, sounds (can be muted), and
  progress is saved automatically.
* Each number has its own colour, and the layout adapts to phones, tablets
  and desktops in portrait and landscape.
* Keyboard: arrows move, `1`–`9` enter, `Backspace`/`0` erase, `K` check
  (Kolla), `L` hint (Ledtråd), `Shift`+number adds a note, `Ctrl+Z` undo.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
npm start          # or: python3 -m http.server
```

It can also be hosted as-is on GitHub Pages.

## Develop

```sh
npm test           # engine unit tests (Node 18+)
```

| Path | What |
| ---- | ---- |
| `js/sudoku.js` | Puzzle engine: generator, solver, difficulty grading |
| `js/app.js` | Game UI, animations, sounds, saving |
| `css/style.css` | Styles and responsive layout |
| `docs/INVESTIGATION.md` | Research on sudoku logic, existing libraries and the layout study |
