# Sudoku Fun 🧩

A colourful, animated sudoku game for kids, in Swedish. Plain HTML, CSS and JavaScript:
no build step, no dependencies, works offline and collects no data.

## Features

* **Two board sizes**
  * **Mini 6 × 6**: numbers 1–6 in boxes of 2 rows × 3 columns. Good for younger kids.
  * **Classic 9 × 9**: numbers 1–9 in 3 × 3 boxes.
* **Tectonic** (also called Suguru): irregular blocks of 1–5 cells, each
  holding 1 up to its size, and equal numbers may never touch, not even
  diagonally. Lätt 5×5, Mellan 6×6, Svår 7×7.
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
* **Players and leaderboard**: pick who is playing (Wille, Johan, Bim or
  Frans) before starting. Tap ✏️ on a player to choose an avatar (🌈 and 31
  more), saved on each device. Solve times are saved and the start screen shows the
  five best times without hints (tap an avatar for that player's own top 5) and the number of games played per board size
  and level. Games solved with hints are counted as played but never appear
  as best times or records.
  Results sync between devices through Firebase; see
  [docs/FIREBASE.md](docs/FIREBASE.md) for the one-time setup.
* **Timer and records**: a clock runs during the game next to the player's
  best time (🏅). Beating your own best (or everyone's) triggers a big
  "NYTT REKORD!" celebration with confetti cannons and a fanfare.
* **Pause and resume**: every unfinished game is saved on the device.
  *Fortsätt* jumps back into the latest one, and *📂 Sparade spel* lists all
  of them (who, board, time, progress) to continue or remove.
* Undo, erase, hints, confetti when you win and sounds (can be muted).
* **Themes** (🎨 on the start screen): 🌈 Färgglad, 🚀 Rymd and 🍬 Godis for
  kids, 🖋️ Elegant for grown-ups and ⬜ Enkel, a plain black-and-white look
  with no animations. The choice is remembered on each device.
* Each number has its own colour (in the kids' themes), and the layout adapts to phones, tablets
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
npm test           # engine and leaderboard unit tests (Node 18+)
```

| Path | What |
| ---- | ---- |
| `js/sudoku.js` | Puzzle engine: generator, solver, difficulty grading |
| `js/app.js` | Game UI, animations, sounds, saving |
| `js/tectonic.js` | Tectonic engine: board builder, solver, difficulty grading |
| `js/leaderboard.js` | Results, statistics and Firestore sync |
| `js/firebase-config.js` | Firebase project settings (empty = this device only) |
| `firestore.rules` | Firestore security rules for the leaderboard |
| `css/style.css` | Styles and responsive layout |
| `css/themes.css` | Colour themes (Rymd, Godis, Elegant, Enkel) |
| `docs/INVESTIGATION.md` | Research on sudoku logic, existing libraries and the layout study |
