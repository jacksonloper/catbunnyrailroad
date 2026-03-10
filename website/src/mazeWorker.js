/**
 * Web Worker for maze generation.
 *
 * Receives: { subtree, mazeSize }
 * Posts back: { result, minSize } where result is the embedTreeInMaze output (or null)
 */
import { binarizeTree, embedTreeInMaze, computeMinMazeSize } from "./mazeEmbed.js";

self.onmessage = function (e) {
  const { subtree, mazeSize } = e.data;
  const bin = binarizeTree(subtree);
  const minSize = computeMinMazeSize(bin);
  const effectiveSize = Math.max(mazeSize ?? 0, minSize);
  const result = embedTreeInMaze(bin, effectiveSize);
  self.postMessage({ result, minSize });
};
