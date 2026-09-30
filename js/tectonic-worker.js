/* Builds Tectonic puzzles in the background so the page never freezes. */
importScripts('tectonic.js');

self.onmessage = (e) => {
  const { id, level } = e.data;
  self.postMessage({ id, puzzle: self.Tectonic.generate(level) });
};
