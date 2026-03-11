/**
 * Web Worker for maze generation.
 *
 * Receives: { subtree, mazeSize }
 * Posts back: { result, attempts } where result is the embedTreeInMaze output
 *   (or null if all attempts within the time budget failed).
 *
 * The worker retries automatically for up to 1 second before giving up.
 */
import { binarizeTree, embedTreeInMaze } from "./mazeEmbed.js";

self.onmessage = function (e) {
  const { subtree, mazeSize } = e.data;
  const bin = binarizeTree(subtree);
  const deadline = Date.now() + 1000;
  let attempts = 0;
  let result = null;
  do {
    attempts++;
    result = embedTreeInMaze(bin, mazeSize);
  } while (!result && Date.now() < deadline);
  self.postMessage({ result, attempts });
};
