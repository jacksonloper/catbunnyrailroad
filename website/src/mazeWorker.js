/**
 * Web Worker for maze generation.
 *
 * Receives: { subtree, mazeSize }
 * Posts back: { result } where result is the embedTreeInMaze output (or null)
 */
import { binarizeTree, embedTreeInMaze } from "./mazeEmbed.js";

self.onmessage = function (e) {
  const { subtree, mazeSize } = e.data;
  const bin = binarizeTree(subtree);
  const result = embedTreeInMaze(bin, mazeSize);
  self.postMessage({ result });
};
