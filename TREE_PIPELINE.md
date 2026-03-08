# How the JSON Tree Is Produced and Simplified

This document explains how `website/scripts/build-data.js` turns
`species.csv` into the two JSON files the website uses at runtime:
`species.json` and `tree.json`.

Run the pipeline with:

```sh
cd website
npm run build-data   # just the data step
npm run build        # data + vite production build
```

---

## 1. Read and deduplicate `species.csv`

`species.csv` is the single source of truth. Each row has:

| Column | Example |
|--------|---------|
| `name` | `butterfly` |
| `scientific_name` | `Lepidoptera` |
| `ott_id` | `965954` |
| `image_url` | `https://…` |

Rows are **deduplicated by `ott_id`** (first occurrence wins).
For example, "dog" and "wolf" both map to OTT 247341 (*Canis lupus*);
wolf is dropped during deduplication.

## 2. Fetch the induced subtree from Open Tree of Life

The deduplicated OTT IDs are sent to the
[induced_subtree API](https://api.opentreeoflife.org/v3/tree_of_life/induced_subtree).

The API returns:
- **`newick`** — a Newick-format phylogenetic tree containing only the
  requested OTT IDs (plus any necessary internal nodes).
- **`broken`** — a map of OTT IDs that are *not monophyletic* in the
  synthetic tree.  Each entry maps an OTT ID (e.g. `"ott28241"`) to the
  label of the replacement node it was placed on (e.g.
  `"ott443203"` or `"mrcaott42481ott42493"`).

## 3. Parse the Newick string

`parseNewick()` converts the Newick string into a nested JavaScript
object tree.  Each node has:

```js
{
  label: "Lepidoptera_ott965954",   // raw label from Newick
  ott_id: 965954,                    // parsed from label
  taxon: "Lepidoptera",             // label with OTT suffix removed
  children: [ … ]
}
```

Labels may be single-quoted (when they contain special characters like
spaces or parentheses) or unquoted.  The parser handles both.

## 4. Build the broken-taxa map

Before simplification, a `brokenMap` is built from the API's `broken`
field.  This map has two flavors of keys:

| Key style | Example key | Example value (original OTT ID) |
|-----------|-------------|--------------------------------|
| MRCA label | `mrcaott42481ott42493` | `42495` |
| OTT label  | `ott443203` | `28241` |

The map tells `simplifyTree` which internal nodes are stand-ins for
broken (non-monophyletic) taxa.

## 5. Simplify the tree (`simplifyTree`)

This is the heart of the pipeline.  It takes the raw parsed tree
and reduces it to contain only species from our list.
The function processes nodes recursively, bottom-up, and handles
several special cases.

### 5a. MRCA-style broken taxa (exact label match)

If a node's label exactly matches a key in `brokenMap`, the node is
converted to a leaf representing the broken taxon:

```
Node "mrcaott42481ott42493"  →  leaf with ott_id 42495, isBroken=true
```

This catches cases where the API mapped a broken taxon to an MRCA node.

### 5b. Leaf nodes

Leaf nodes are kept only if their `ott_id` is in the species set.
Otherwise they are pruned (return `null`).

Before pruning, the function also checks for **OTT-style broken taxa
that ended up as leaves** (e.g. a node labeled `Nephropoidea_ott443203`
that is a leaf because all its descendants were pruned).  If the node's
OTT key (e.g. `"ott443203"`) is in `brokenMap`, it is converted to a
broken-taxon leaf with the original OTT ID.

### 5c. Recursive child simplification

For internal nodes, all children are recursively simplified and any
`null` results (pruned nodes) are filtered out.

### 5d. Higher-taxon species

Some species in our list use a higher-taxon OTT ID that corresponds to
an **internal node** rather than a leaf.  For example:

- **butterfly** = Lepidoptera (OTT 965954), an order that is also an
  ancestor of **moth** (Actias luna, OTT 180968)

Without special handling, the Lepidoptera internal node would just
be a passthrough and butterfly would be lost from the tree (not
findable by `findPath` in the browser, which only matches leaves).

The fix: when an internal node's `ott_id` is in the species set,
a **new leaf child** is added with that same `ott_id`.  This makes the
species findable as a leaf while preserving the tree structure for its
descendants.

```
Before:                    After:
Lepidoptera (internal)     Lepidoptera (internal)
  └─ moth                    ├─ moth
                             └─ butterfly  ← new leaf child
```

### 5e. OTT-style broken taxa on internal nodes

Similar to the MRCA-style check at the top, but for broken taxa whose
replacement node has an OTT-style label (e.g. `Fagales_ott267709`) that
doesn't exactly match the `brokenMap` key.  The function checks whether
the node's formatted OTT key (`"ott" + ott_id`) is in `brokenMap` and,
if so, adds a broken-taxon leaf child.

### 5f. Pruning and collapsing

After all children are processed:

- If **no children** remain → prune this node (return `null`).
- If **exactly one child** remains → collapse: replace this node with
  its sole child (removes unnecessary intermediate nodes).
- Otherwise → keep the node with its remaining children.

## 6. Convert to compact JSON (`treeToCompact`)

The simplified tree is converted to a compact format for the browser:

```js
// Internal node
{ name: "Carnivora", ott_id: 44565, children: [ … ] }

// Leaf node (species)
{ name: "dog", ott_id: 247341, children: [] }

// Broken-taxon leaf
{ name: "lobster", ott_id: 28241, children: [], broken: true, mrca_label: "ott443203" }
```

Leaf names come from `species.csv` (the common name).  Internal node
names come from the Newick label's taxon portion.

## 7. Resolve broken-taxa names

For leaf nodes marked `broken: true`, the build resolves a
human-readable taxon name for the MRCA / replacement node:

- **MRCA-style labels** (`mrcaott37377ott106844`): queries the
  [MRCA API](https://api.opentreeoflife.org/v3/tree_of_life/mrca)
  with the two embedded OTT IDs to get `nearest_taxon.name`.
- **OTT-style labels** (`Fagales_ott267709`): queries the
  [taxonomy API](https://api.opentreeoflife.org/v3/taxonomy/taxon_info)
  to get the taxon name directly.

The resolved name is stored as `mrca_name` on the tree node and
propagated to `species.json`.

## 8. Output files

### `src/data/tree.json`

The compact tree used for MRCA lookups and subtree rendering in the
browser.  Internal nodes may have `ott_id: null` (unnamed MRCA nodes).

### `src/data/species.json`

A flat array of species objects:

```js
{
  "name": "butterfly",
  "ott_id": 965954,
  "image_url": "https://…",
  // only if broken:
  "broken": true,
  "mrca_name": "Mesangiospermae"
}
```

Both files are listed in `website/.gitignore` because they are
regenerated on every build from `species.csv` + API data.

---

## Diagram: data flow

```
species.csv
    │
    ▼
┌───────────────────┐
│  build-data.js    │
│                   │
│  1. parse CSV     │
│  2. dedup by OTT  │
│  3. fetch tree ───┼──► Open Tree of Life API
│  4. parse Newick  │         (induced_subtree)
│  5. simplifyTree  │
│  6. treeToCompact │
│  7. resolve names ┼──► MRCA API / taxonomy API
│  8. write JSON    │
└───────┬───────────┘
        │
        ▼
  src/data/tree.json
  src/data/species.json
        │
        ▼
  App.jsx (browser)
    • findPath / findMRCA
    • SVG cladogram layout
```
