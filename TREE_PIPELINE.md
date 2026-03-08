# How the JSON Tree Is Produced

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

| Column | Example | Required |
|--------|---------|----------|
| `name` | `butterfly` | ✓ |
| `scientific_name` | `Lepidoptera` | ✓ |
| `ott_id` | `965954` | ✓ |
| `node_id` | `mrcaott37377ott106844` | optional |
| `image_url` | `https://…` | optional |
| `comments` | `Oak is not monophyletic…` | optional |

**Every row must have a valid, unique `ott_id`.**  If two rows share
the same OTT ID, the build fails immediately.  A CI workflow
(`.github/workflows/check-csv.yml`) also catches duplicates on PRs.

### The `node_id` column

Some taxa have OTT IDs that are *not monophyletic* in the synthetic
tree (the Open Tree of Life API calls these "broken" taxa).  When you
query the tree with a broken OTT ID, the API remaps it to a different
node — which we treat as a build error.

The `node_id` column lets you specify an alternative node identifier
to use **instead** of the OTT ID when querying the tree.  This can be:

- An OTT-style ID: `ott443203` (e.g. a parent taxon that IS in the tree)
- An MRCA-style ID: `mrcaott42481ott42493` (an internal node in the
  synthetic tree)

If `node_id` is blank, the build uses `ott<ott_id>` automatically.

### The `comments` column

When `node_id` differs from `ott_id`, or any other complexity exists,
the `comments` column should explain the situation.  Comments are
shown to users via a clickable ★ footnote on the website.

## 2. Fetch the induced subtree from Open Tree of Life

For each row, the build computes a **tree ID**:
- If `node_id` is present → use it directly
- Otherwise → `"ott" + ott_id`

These tree IDs are sent to the
[induced_subtree API](https://api.opentreeoflife.org/v3/tree_of_life/induced_subtree)
via the `node_ids` parameter (string-based, not `ott_ids`).

The API returns:
- **`newick`** — a Newick-format phylogenetic tree containing the
  requested node IDs (plus any necessary internal nodes).
- **`broken`** — a map of any IDs that are not monophyletic.

**If the API reports ANY broken taxa, the build fails.**  This means
every ID we send must resolve directly to a node in the synthetic tree.
To fix: add a `node_id` to the offending row and re-run the build.
The error message tells you which replacement node to use.

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

## 4. Simplify the tree (`simplifyTree`)

The raw API tree contains many intermediate nodes.
`simplifyTree` prunes it down to only the branches relevant to our
taxa list.  **Taxa may sit on internal nodes** — they are
NOT forced to be leaves.

The function walks the tree recursively:

1. **Mark taxa**: If a node's label or `"ott" + ott_id` matches one
   of our tree IDs, it is marked `isTaxon = true`.
2. **Recurse and prune**: Children are recursively simplified.
   - No children and not a taxon → pruned.
   - Single child and not a taxon → collapsed (replaced by the child).
   - Otherwise → kept.

Since broken taxa are prevented at the API level (via `node_id`),
there is no broken-taxa handling in simplification.

## 5. Convert to compact JSON (`treeToCompact`)

The simplified tree is converted to a compact format for the browser.
Each node has `{ name, ott_id, children }`.  Taxon nodes additionally
have `isTaxon: true`.

```js
// Internal node (not a taxon)
{ name: "Carnivora", ott_id: 44565, children: [ … ] }

// Leaf taxon
{ name: "dog", ott_id: 247341, children: [], isTaxon: true }

// Internal taxon (e.g. butterfly = Lepidoptera, ancestor of moth)
{ name: "butterfly", ott_id: 965954, children: [ … ], isTaxon: true }
```

Taxon names come from `species.csv` (the common name).

## 6. Post-build verification

After building the compact tree, the build verifies:

1. **Each taxon appears exactly once** in the tree (no duplicates).
2. **Every CSV row is accounted for** — no taxa are missing from the
   tree.  If either check fails, the build errors out.

## 7. Output files

### `src/data/tree.json`

The compact tree used for MRCA lookups and subtree rendering in the
browser.  Nodes with `isTaxon: true` are the user-visible organisms.

### `src/data/taxa.json`

A flat array of taxon objects:

```js
{
  "name": "oak",
  "ott_id": 791121,
  "image_url": "https://…",
  // only if the CSV has a comments field:
  "comments": "Oak (Quercus) is not monophyletic in the synthetic tree. Placed at Fagales instead."
}
```

Both files are listed in `website/.gitignore` because they are
regenerated on every build from `species.csv` + API data.

---

## Key design decisions

### Taxa can be internal nodes

A taxon like "butterfly" (Lepidoptera) is an order — it's an ancestor
of "moth" in the tree.  The internal node is simply marked
`isTaxon: true`.  The website's `findPath()` matches any node by
`ott_id`, not just leaves.

### No duplicate OTT IDs

Every row in `species.csv` must have a unique OTT ID.  This is
enforced by:
1. The CI workflow `.github/workflows/check-csv.yml` (on PRs/pushes)
2. The `fill-ott-ids.mjs` script (after resolving new IDs)
3. The `build-data.js` build step (at the start)

### Broken taxa handled via `node_id`

Instead of letting the API silently remap broken taxa and then
resolving their names post-hoc, we prevent the problem at the source.
Each broken taxon gets a `node_id` that IS in the synthetic tree,
with a `comments` field explaining the situation.  If any ID is still
broken at build time, the build fails with a clear error message.

### Comments as footnotes

Taxa with `comments` in the CSV show a clickable ★ star on the
website.  Clicking it reveals the explanatory text.

---

## Diagram: data flow

```
species.csv
    │
    ▼
┌────────────────────────────────┐
│  build-data.js                 │
│                                │
│  1. validate CSV               │
│  2. compute tree IDs           │
│     (node_id or "ott"+ott_id)  │
│  3. fetch tree ────────────────┼──► Open Tree of Life API
│  4. reject if any broken       │         (induced_subtree)
│  5. parse Newick               │
│  6. simplifyTree               │
│  7. treeToCompact              │
│  8. verify all taxa present    │
│  9. write JSON                 │
└────────────┬───────────────────┘
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
         • ★ comment footnotes
```
