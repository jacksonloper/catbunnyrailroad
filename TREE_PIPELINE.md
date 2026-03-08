# How the JSON Tree Is Produced and Simplified

This document explains how `website/scripts/build-data.js` turns
`species.csv` into the two JSON files the website uses at runtime:
`taxa.json` and `tree.json`.

Run the pipeline with:

```sh
cd website
npm run build-data   # just the data step
npm run build        # data + vite production build
```

---

## 1. Validate `species.csv`

`species.csv` is the single source of truth.  Each row represents one
**taxon** (which may be a species, genus, family, order, etc.).
Columns:

| Column | Example |
|--------|---------|
| `name` | `butterfly` |
| `scientific_name` | `Lepidoptera` |
| `ott_id` | `965954` |
| `image_url` | `https://…` |

**Every row must have a valid, unique `ott_id`.**  If two rows share
the same OTT ID, the build fails immediately.  A CI workflow
(`.github/workflows/check-csv.yml`) also catches duplicates on PRs.

## 2. Fetch the induced subtree from Open Tree of Life

The OTT IDs are sent to the
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

## 4. Build the broken-taxa map and check for collisions

A `brokenMap` is built from the API's `broken` field:

| Key style | Example key | Example value (original OTT ID) |
|-----------|-------------|--------------------------------|
| MRCA label | `mrcaott42481ott42493` | `42495` |
| OTT label  | `ott443203` | `28241` |

Before proceeding, the build checks for **broken-taxa collisions**: if
two different taxa are both mapped to the *same* replacement node, the
build fails.  This would mean two distinct CSV rows collapse to a single
tree node, which is ambiguous.  The fix is to adjust `species.csv`
(e.g. use a more specific OTT ID for one of the colliding taxa).

## 5. Simplify the tree (`simplifyTree`)

The raw API tree contains thousands of intermediate nodes.
`simplifyTree` prunes it down to only the branches relevant to our
taxa list.  **Importantly, taxa may sit on internal nodes** — they are
NOT forced to be leaves.

The function walks the tree recursively and does:

### 5a. Mark broken taxa

If a node's label matches a `brokenMap` key (either an MRCA-style label
like `mrcaott42481ott42493` or an OTT-style key like `ott443203`), the
node's `ott_id` is reassigned to the original taxon's OTT ID and it is
marked `isTaxon = true`, `isBroken = true`.

### 5b. Mark taxa

Any node whose `ott_id` is in the taxa set gets `isTaxon = true`.
This includes internal nodes — for example, butterfly (Lepidoptera,
OTT 965954) is an internal node that is the ancestor of moth.
In the old design a synthetic leaf child would be added; now the node
simply stays internal with `isTaxon = true`.

```
butterfly (isTaxon, internal)
  └─ moth (isTaxon, leaf)
```

### 5c. Recurse and prune

Children are recursively simplified.  Nodes that are pruned (`null`)
are filtered out.  Then:

- **No children and not a taxon** → pruned.
- **Single child and not a taxon** → collapsed (replaced by the child).
- **Otherwise** → kept.

## 6. Convert to compact JSON (`treeToCompact`)

The simplified tree is converted to a compact format for the browser.
Each node has `{ name, ott_id, children }`.  Taxon nodes additionally
have `isTaxon: true`.  Broken taxa have `broken: true, mrca_label`.

```js
// Internal node (not a taxon)
{ name: "Carnivora", ott_id: 44565, children: [ … ] }

// Leaf taxon
{ name: "dog", ott_id: 247341, children: [], isTaxon: true }

// Internal taxon (e.g. butterfly = Lepidoptera, ancestor of moth)
{ name: "butterfly", ott_id: 965954, children: [ … ], isTaxon: true }

// Broken taxon
{ name: "lobster", ott_id: 28241, children: [], isTaxon: true, broken: true, mrca_label: "ott443203" }
```

Taxon names come from `species.csv` (the common name).  Non-taxon
internal node names come from the Newick label's taxon portion.

## 7. Post-build verification

After building the compact tree, the build verifies:

1. **Each taxon appears exactly once** in the tree (no duplicates).
2. **Every CSV row is accounted for** — no taxa are missing from the
   tree.  If either check fails, the build errors out.

## 8. Resolve broken-taxa names

For nodes marked `broken: true`, the build resolves a human-readable
taxon name for the replacement node:

- **MRCA-style labels** (`mrcaott37377ott106844`): queries the
  [MRCA API](https://api.opentreeoflife.org/v3/tree_of_life/mrca)
  with the two embedded OTT IDs to get `nearest_taxon.name`.
- **OTT-style labels** (`Fagales_ott267709`): queries the
  [taxonomy API](https://api.opentreeoflife.org/v3/taxonomy/taxon_info)
  to get the taxon name directly.

The resolved name is stored as `mrca_name` on the tree node and
propagated to `taxa.json`.

## 9. Output files

### `src/data/tree.json`

The compact tree used for MRCA lookups and subtree rendering in the
browser.  Nodes with `isTaxon: true` are the user-visible organisms.
Non-taxon internal nodes may have `ott_id: null`.

### `src/data/taxa.json`

A flat array of taxon objects:

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

## Key design decisions

### Taxa can be internal nodes

A taxon like "butterfly" (Lepidoptera) is an order — it's an ancestor
of "moth" in the tree.  Rather than creating a synthetic leaf child
(the old approach), the internal node is simply marked `isTaxon: true`.
The website's `findPath()` matches any node by `ott_id`, not just
leaves, and `getTaxa()` collects names from all `isTaxon` nodes.

### No duplicate OTT IDs

Every row in `species.csv` must have a unique OTT ID.  This is
enforced by:
1. The CI workflow `.github/workflows/check-csv.yml` (on PRs/pushes)
2. The `fill-ott-ids.mjs` script (after resolving new IDs)
3. The `build-data.js` build step (at the start)

### Broken-taxa collisions are build errors

If the Open Tree of Life API maps two of our taxa to the same
replacement node (e.g. because both are non-monophyletic and happen
to share an MRCA), the build fails.  The fix is to adjust
`species.csv` to avoid the collision.

---

## Diagram: data flow

```
species.csv
    │
    ▼
┌───────────────────┐
│  build-data.js    │
│                   │
│  1. validate CSV  │
│  2. fetch tree ───┼──► Open Tree of Life API
│  3. parse Newick  │         (induced_subtree)
│  4. broken map    │
│  5. simplifyTree  │
│  6. treeToCompact │
│  7. verify        │
│  8. resolve names ┼──► MRCA API / taxonomy API
│  9. write JSON    │
└───────┬───────────┘
        │
        ▼
  src/data/tree.json
  src/data/taxa.json
        │
        ▼
  App.jsx (browser)
    • findPath / findMRCA
    • getTaxa (collects isTaxon nodes)
    • SVG cladogram layout
```
