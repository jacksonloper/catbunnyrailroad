# How the JSON Tree Is Produced

This document explains how `scripts/build-data.js` turns
`taxa.csv` into the two JSON files the website uses at runtime:
`taxa.json` and `tree.json`.

Run the pipeline with:

```sh
node scripts/build-data.js
```

The generated JSON files (`website/src/data/tree.json` and
`website/src/data/taxa.json`) are **committed to the repository**.
The website build (`cd website && npm run build`) just runs Vite —
it does not call any external APIs.

---

## 1. Validate `taxa.csv`

`taxa.csv` is the single source of truth.  Each row represents one
**taxon** (which may be a species, genus, family, order, etc.).
Columns:

| Column | Example | Required |
|--------|---------|----------|
| `name` | `swallowtail butterfly` | ✓ |
| `scientific_name` | `Papilionidae` | ✓ |
| `ott_id` | `661439` | ✓ |
| `uniqname` | `Papilionidae` | optional |
| `image_url` | `https://…` | optional |
| `comments` | `Swallowtail butterflies are…` | optional |

**Every row must have a valid, unique `ott_id`.**  If two rows share
the same OTT ID, the build fails immediately.  A CI workflow
(`.github/workflows/check-csv.yml`) also catches duplicates on PRs.

### The `scientific_name` and `uniqname` columns

The `scientific_name` column is **overwritten** by `fill-ott-ids.mjs`
with the canonical name from the Open Tree of Life taxonomy.  Whatever
you initially enter is only used as the search query.  After the
script runs, `scientific_name` always equals the OTT canonical name.

`uniqname` stores the disambiguated name (e.g. including "species
in domain Eukaryota" when needed to distinguish homonyms).

### No broken taxa

Only **monophyletic** taxa are allowed.  If a taxon's OTT ID is
"broken" (non-monophyletic) in the synthetic tree, the build fails.
The `fill-ott-ids.mjs` script validates this as well.  Remove the
offending row or use a monophyletic alternative.

### The `comments` column

When any complexity exists, the `comments` column should explain the
situation.  Comments are shown to users via a clickable ★ footnote
on the website.

## 2. Fetch the induced subtree from Open Tree of Life

For each row, the build computes a **tree ID**: `"ott" + ott_id`.

These tree IDs are sent to the
[induced_subtree API](https://api.opentreeoflife.org/v3/tree_of_life/induced_subtree)
via the `node_ids` parameter (string-based, not `ott_ids`).

The API returns:
- **`newick`** — a Newick-format phylogenetic tree containing the
  requested node IDs (plus any necessary internal nodes).
- **`broken`** — a map of any IDs that are not monophyletic.

**If the API reports ANY broken taxa, the build fails.**  This means
every ID we send must resolve directly to a node in the synthetic tree.

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

## 5. ~~Resolve polytomies~~ (removed from build)

Previous versions resolved soft polytomies at build time.  This is
**no longer done** — the tree may contain internal nodes with more than
two children (soft polytomies from the Open Tree API).  The
`resolvePolytomies` and `checkBinaryTree` helpers are retained in
`build-data.js` for reference; binarization is performed **at runtime**
when needed (e.g. for the maze embedding feature in the browser).

## 6. Convert to compact JSON (`treeToCompact`)

The simplified tree is converted to a compact format for the browser.
Each node has `{ name, ott_id, children }`.  Taxon nodes additionally
have `isTaxon: true`.

```js
// Internal node (not a taxon)
{ name: "Carnivora", ott_id: 44565, children: [ … ] }

// Leaf taxon
{ name: "dog", ott_id: 247341, children: [], isTaxon: true }

// Internal taxon (e.g. frog = Anura, a higher-level order)
{ name: "frog", ott_id: 991547, children: [ … ], isTaxon: true }
```

Taxon names come from `taxa.csv` (the common name).

## 7. Post-build verification

After building the compact tree, the build verifies:

1. **Each taxon appears exactly once** in the tree (no duplicates).
2. **Every CSV row is accounted for** — no taxa are missing from the
   tree.  If any check fails, the build errors out.

## 8. Output files

### `website/src/data/tree.json`

The compact tree used for MRCA lookups and subtree rendering in the
browser.  Nodes with `isTaxon: true` are the user-visible organisms.

### `website/src/data/taxa.json`

A flat array of taxon objects:

```js
{
  "name": "swallowtail butterfly",
  "ott_id": 661439,
  "image_url": "https://…",
  "comments": "Swallowtail butterflies (Papilionidae) are one family…"
}
```

Both files are **committed to the repository**.  They are regenerated
by running `node scripts/build-data.js` whenever `taxa.csv` changes.

---

## Key design decisions

### Taxa can be internal nodes

A taxon like "frog" (Anura, OTT 991547) is an order — it's an
ancestor of many specific frog species in the tree.  The internal node is
simply marked `isTaxon: true`.  The website's `findPath()` matches any node
by `ott_id`, not just leaves.

### No duplicate OTT IDs

Every row in `taxa.csv` must have a unique OTT ID.  This is
enforced by:
1. The CI workflow `.github/workflows/check-csv.yml` (on PRs/pushes)
2. The `fill-ott-ids.mjs` script (after resolving new IDs)
3. The `build-data.js` build step (at the start)

### Monophyletic taxa only

Broken (non-monophyletic) taxa are not allowed.  Both
`fill-ott-ids.mjs` and `build-data.js` validate this by checking the
Open Tree API response for broken entries.  If a taxon is broken,
remove it or choose a monophyletic alternative.

### Comments as footnotes

Taxa with `comments` in the CSV show a clickable ★ star on the
website.  Clicking it reveals the explanatory text.

---

## Diagram: data flow

```
taxa.csv
    │
    ▼
┌────────────────────────────────┐
│  scripts/build-data.js         │
│                                │
│  1. validate CSV               │
│  2. compute tree IDs           │
│     ("ott" + ott_id)           │
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
       website/src/data/tree.json  (committed)
       website/src/data/taxa.json  (committed)
             │
             ▼
       App.jsx (browser)
         • findPath / findMRCA
         • getTaxa (collects isTaxon nodes)
         • SVG cladogram layout
         • ★ comment footnotes
```
