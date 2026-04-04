# Ingressing New Taxa

This document describes the process for adding new organisms (taxa) to the Cat Bunny Railroad dataset.

**Important:** Only **monophyletic** taxa are allowed.  If a taxon is "broken" (non-monophyletic) in the Open Tree of Life synthetic tree, it cannot be included.  Choose a monophyletic alternative or leave it out.

## Step 1: Add Rows to `taxa.csv`

Open `taxa.csv` and add one row per new organism. You need to fill in at least:

| Column | Required | What to put |
|--------|----------|-------------|
| `name` | ✓ | A friendly common name simple enough for a 6-year-old (e.g. `cat`, `strawberry`). Must still be precise enough that it is not misleading about what the OTT actually represents. |
| `scientific_name` | ✓ | Binomial name, genus, family, or order (e.g. `Felis catus`, `Rosa`, `Chiroptera`). **Overwritten** in Step 2 with the canonical OTT name — your initial value is just used as the search query. |
| `ott_id` | | Leave empty — filled automatically in Step 2 |
| `uniqname` | | Leave empty — filled automatically in Step 2 |
| `image_url` | | Leave empty — filled automatically in Step 3 |
| `comments` | | Leave empty unless needed |

Example new rows:

```
axolotl,Ambystoma mexicanum,,,,
red panda,Ailurus fulgens,,,,
```

**Tips:**
- Higher-level taxa (families like `Delphinidae`, orders like `Lepidoptera`, genera like `Rosa`) are fine to use as `scientific_name` when the common name refers to a broad group.  These will become **internal nodes** in the tree — the website handles this correctly.
- For hybrid species, include the `×` symbol (e.g. `Fragaria × ananassa`).
- The scripts use `scientific_name` (not `name`) for lookups, so getting the scientific name right matters most.
- **Every row must have a unique OTT ID.**  Two rows with the same OTT ID will fail CI and the build.
- **Only monophyletic taxa.**  If the OTT ID turns out to be broken/non-monophyletic, the scripts will report an error.  You must either remove the row or use a different scientific name that IS monophyletic.

## Step 2: Fill OTT IDs and Taxonomy Names

Run:

```sh
node scripts/fill-ott-ids.mjs
```

This does four things:

1. **Fills `ott_id`** for any rows that are missing one (via the Open Tree TNRS API).
2. **Fills `uniqname`** for every row — the unique (disambiguated) name from the Open Tree taxonomy.
3. **Overwrites `scientific_name`** with the canonical OTT name.  Your original value is only used as the query — after the script runs, `scientific_name` always equals the OTT canonical name.
4. **Validates against the synthetic tree** — checks that none of the OTT IDs are broken (non-monophyletic).  If any are, the script exits with an error listing the offending taxa.

**Reading the log output:**

The log shows three values per taxon so you can judge whether the
front-facing `name` is appropriate:

```
  ✓ name="frog"  queried="Anura"  ott="Anura"  (Anura)
```

- **name** — the front-facing common name (what kids will see)
- **queried** — the scientific name you entered (used as the TNRS search query)
- **ott** — the official canonical name in the Open Tree taxonomy (what `scientific_name` is set to)

If the OTT name covers more than the common name implies, consider
updating `name`.  For example, Anura includes both frogs *and* toads,
so "frog" alone might be misleading — "frog and toad" is more accurate.

**What else to look for:**
- `✗` lines mean no match was found for that name. Common causes:
  - Misspelled scientific name — fix the spelling in `taxa.csv` and rerun.
  - The name is too informal or ambiguous — use a more precise scientific name.
  - The organism is not in the Open Tree of Life taxonomy — rare, but possible. You may need to look up the OTT ID manually at <https://tree.opentreeoflife.org/taxonomy/browse> and enter it by hand.
- `❌ Duplicate OTT ID` — two rows have the same OTT ID.  Remove one of them or use a different OTT ID.
- `❌ The following taxa are broken` — the taxon is not monophyletic.  Remove it or use a monophyletic alternative.

## Step 3: Fill Image URLs

Run:

```sh
node scripts/fill-image-urls.mjs
```

This fetches image URLs for any rows missing one, using a multi-source fallback chain:

1. **OneZoom** — direct lookup by OTT ID
2. **Recursive descent** — for higher taxa (families, orders) where OneZoom has no direct image, walks down the taxonomy tree to find a representative descendant species with an image
3. **Wikidata via NCBI ID** — uses the OTT→NCBI→Wikidata bridge
4. **Wikidata via scientific name** — last resort

**What to look for:**
- `✓` lines mean an image was found — good.
- `✗ No image found` means all four strategies failed. You will need to find an image URL manually (e.g. from Wikimedia Commons) and paste it into the `image_url` column.
- `"All rows already have image URLs. Nothing to do."` means every row already has a URL.

## Step 4: Download Images Locally

Run:

```sh
node scripts/download-images.mjs
```

This downloads each taxon's image from its remote source URL (in `taxa.csv`) and saves a local copy at `website/public/taxa-images/{ott_id}.jpg`.  These local images are served as static assets so they work reliably with the canvas-based PNG export (which requires same-origin images).

The script skips images that already exist locally, so it is safe to rerun.

**What to look for:**
- `FAIL ... HTTP 404` — the source URL is broken.  Find a replacement URL on Wikimedia Commons and update `image_url` in `taxa.csv`, then rerun.
- `FAIL ... HTTP 429` — rate-limited. Wait a moment and rerun — existing images are skipped, so only the failed ones will be retried.

**The downloaded images should be committed to the repository** alongside the JSON files.

## Step 5: Build the Data JSON

Run:

```sh
node scripts/build-data.js
```

This fetches the phylogenetic tree from Open Tree of Life and produces two JSON files that the website uses:

- `website/src/data/tree.json` — the compact tree for MRCA lookups and rendering
- `website/src/data/taxa.json` — flat array of taxa with metadata

**These JSON files are committed to the repository** (along with the local images from Step 4) so that the website build itself does not need to call external APIs.  After running this script, commit the updated JSON files.

**What to look for:**
- `❌ Row with invalid ott_id` — a row has a non-numeric or missing OTT ID. Go back and fix it in `taxa.csv`.
- `❌ Duplicate ott_id` — two rows share the same OTT ID.
- `❌ The API reported broken (non-monophyletic) taxa` — should not happen if Step 2 passed, but if it does, fix `taxa.csv`.
- `❌ taxa not found in tree` — a taxon could not be placed in the tree.  Check the OTT ID is correct.

## Step 6: Build and Verify the Website

```sh
cd website
npm run build
```

This runs only the Vite production build (no API calls — data was built in Step 5).  Preview with `npm run preview` to check the tree looks right.

## Step 7: Fixing Edge Cases by Hand

Most errors should be fixable by correcting `taxa.csv` and rerunning the scripts. But there are a few known one-off situations that require manual intervention:

- **Hybrid species with pruned OTT IDs**: Some hybrids (e.g. `Fragaria × ananassa`, OTT 3904118) have OTT IDs that are "pruned" from the synthetic tree. The fix is to use the parent genus OTT ID instead (e.g. `208027` for `Fragaria`). You'll know this happened if the build fails with an error like `"'ott<id>' was not found! pruned_ott_id"`.
- **No image from any automated source**: If `fill-image-urls.mjs` reports `✗ No image found`, find an appropriate image URL on Wikimedia Commons and paste it directly into the `image_url` column.
- **Wrong image**: The automated lookup sometimes picks a less-than-ideal representative image (especially for higher taxa via recursive descent). Replace the `image_url` with a better one by hand.  Then delete the old local image at `website/public/taxa-images/{ott_id}.jpg` before rerunning `download-images.mjs` (it skips existing files).
- **TNRS returns the wrong taxon**: Occasionally the name resolution picks a different organism than intended (e.g. a homonym in a different kingdom). Check the OTT ID at <https://tree.opentreeoflife.org/taxonomy/browse?id=OTTID> and replace it manually if it's wrong.  The log output (showing queried name vs OTT name) and the `uniqname` column can help you spot mismatches.

**Rule of thumb**: If a problem is a weird one-off, fix it by hand in `taxa.csv`. If it's a systematic issue (e.g. a whole class of names failing), fix it in the scripts instead.

## Naming Internal Clades

There are **two ways** to give an internal node in the tree a display name (e.g. "rosid", "Brassicales").  Which one you use depends on whether the clade is monophyletic in the OTT synthetic tree.

### Option A: Add the clade directly to `taxa.csv` (monophyletic only)

If the clade is **monophyletic** in the OTT synthetic tree, you can add it to `taxa.csv` just like any leaf taxon.  Use the order/family/clade scientific name as `scientific_name`.  The build scripts handle this correctly — the taxon becomes an `isTaxon: true` internal node in the tree, sitting above its descendant taxa.  It gets its own card (image + name) in the walkabout view and appears as a selectable organism everywhere else.

For example, **Brassicales** (ott 8844) and **Malvales** (ott 229284) are monophyletic, so they live in `taxa.csv`:

```
Brassicales,Brassicales,8844,Brassicales,<image_url>,
Malvales,Malvales,229284,Malvales,<image_url>,
```

Run `fill-ott-ids.mjs` — if it reports `❌ broken (non-monophyletic)` for the clade, it **cannot** go in `taxa.csv`.  Use Option B instead.

**If the clade is in `taxa.csv`, do NOT also add it to `internal_nodes.csv`** — that would create a duplicate node in the tree.

### Option B: Label via MRCA in `internal_nodes.csv` (non-monophyletic clades)

Many well-known clades (fabids, malvids, lamiids, etc.) are **non-monophyletic** ("broken") in the current OTT synthetic tree.  The tree API remaps them to a different node, so they cannot be used as taxa IDs.  Instead, they are labeled after tree construction by finding the **Most Recent Common Ancestor (MRCA)** of two known descendant taxa.

Add a row to `internal_nodes.csv` at the repo root:

| Column | What to put |
|--------|-------------|
| `name` | Display name for the clade (e.g. `fabid`, `Solanales`) |
| `ott_id` | The OTT taxonomy ID (for reference — may be 0 if truly broken) |
| `descendant_a` | `ott_id` of one descendant taxon that IS in `taxa.csv` |
| `descendant_b` | `ott_id` of another descendant taxon that IS in `taxa.csv` |

The two descendants should be chosen so that their MRCA is exactly the clade you want to label.  Pick taxa from different major sub-branches of the clade.

During `build-data.js`, the script finds the MRCA of the two descendants in the simplified tree and assigns the clade name to that node.  If the node already has a meaningful name (not starting with `mrca`), it is skipped — this prevents overwriting names of clades that were added via `taxa.csv`.

**Known non-monophyletic clades** (as of 2026-04): fabid (565281), malvid (565277), Solanales (1050255), lamiid (596112), Gentianales (524062), Sapindales (229288).  These can only be named via `internal_nodes.csv`.

### Decision flow

1. Look up the clade's OTT ID at <https://tree.opentreeoflife.org/taxonomy/browse>
2. Add it to `taxa.csv` and run `fill-ott-ids.mjs`
3. If it passes monophyly check → keep it in `taxa.csv`, proceed with the normal ingress pipeline
4. If it fails (`❌ broken`) → remove it from `taxa.csv` and add it to `internal_nodes.csv` instead, choosing two descendant ott_ids that bracket the clade

## Meta: Revisit This Document

**This file (INGRESS.md) should itself be revisited each time you ingress new taxa.** If you discover new edge cases, new failure modes, or better workflows, update this document so the next person benefits.
