// ---------------------------------------------------------------------------
// Trie-based autocomplete utilities (shared between App and ExplorePage)
// ---------------------------------------------------------------------------

class TrieNode {
  constructor() {
    this.children = {};
    this.items = [];
  }
}

export function buildTrie(items) {
  const root = new TrieNode();
  for (const item of items) {
    // Index each word in the name so "swallowtail butterfly" matches "butterfly"
    const words = item.name.toLowerCase().split(/\s+/);
    const seenNodes = new Set(); // avoid duplicate insertions for same prefix
    for (const word of words) {
      let node = root;
      for (const ch of word) {
        if (!node.children[ch]) node.children[ch] = new TrieNode();
        node = node.children[ch];
        if (!seenNodes.has(node)) {
          node.items.push(item);
          seenNodes.add(node);
        }
      }
    }
  }
  return root;
}

export function trieSearch(root, prefix) {
  let node = root;
  for (const ch of prefix.toLowerCase()) {
    if (!node.children[ch]) return [];
    node = node.children[ch];
  }
  return node.items;
}
