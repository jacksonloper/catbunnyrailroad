# Ingressing New Species

This document describes the process for adding new organisms to the Cat Bunny Railroad dataset.

## Step 1: Add Rows to `species.csv`

Open `species.csv` and add one row per new organism. You only need to fill in two columns:

| Column | Required | What to put |
|--------|----------|-------------|
| `name` | ✓ | Common English name (e.g. `cat`, `strawberry`) |
| `scientific_name` | ✓ | Binomial name, genus, family, or order (e.g. `Felis catus`, `Rosa`, `Chiroptera`) |
| `ott_id` | | Leave empty — filled automatically in Step 2 |
| `image_url` | | Leave empty — filled automatically in Step 3 |

Example new rows:

```
axolotl,Ambystoma mexicanum,,
red panda,Ailurus fulgens,,
```

**Tips:**
- Higher-level taxa (families like `Delphinidae`, orders like `Lepidoptera`, genera like `Rosa`) are fine to use as `scientific_name` when the common name refers to a broad group.
- For hybrid species, include the `×` symbol (e.g. `Fragaria × ananassa`).
- The scripts use `scientific_name` (not `name`) for lookups, so getting the scientific name right matters most.

## Step 2: Fill OTT IDs

Run:

```sh
node scripts/fill-ott-ids.mjs
```

This queries the Open Tree of Life TNRS (Taxonomic Name Resolution Service) API and fills in the `ott_id` column for any rows that are missing one.

**What to look for:**
- `✓` lines mean a match was found — good.
- `✗` lines mean no match was found for that name. Common causes:
  - Misspelled scientific name — fix the spelling in `species.csv` and rerun.
  - The name is too informal or ambiguous — use a more precise scientific name.
  - The organism is not in the Open Tree of Life taxonomy — rare, but possible. You may need to look up the OTT ID manually at <https://tree.opentreeoflife.org/taxonomy/browse> and enter it by hand.
- `"All rows already have OTT IDs. Nothing to do."` means every row already has an ID.

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

## Step 4: Build and Verify

After filling OTT IDs and image URLs, build the website to check for data issues:

```sh
cd website
npm run build
```

**What to look for in the build output:**
- `Skipping row with invalid ott_id: <name>` — a row has a non-numeric or missing OTT ID. Go back and fix it in `species.csv`.
- `Skipping duplicate ott_id <id> (<name>)` — two rows share the same OTT ID. This is expected in some cases (e.g. dog and wolf are both *Canis lupus*) but unexpected duplicates should be investigated.
- `Broken taxon: ott<id> mapped to node <label>` — the taxon is not monophyletic in the synthetic tree. The build handles this automatically by mapping it to its MRCA, but the species will display with an `≈` marker. This is informational, not an error.
- `Warning: could not resolve <name>` — MRCA name resolution failed. Usually non-fatal, but worth a look.

## Step 5: Fixing Edge Cases by Hand

Most errors should be fixable by correcting `species.csv` and rerunning the scripts. But there are a few known one-off situations that require manual intervention:

- **Hybrid species with pruned OTT IDs**: Some hybrids (e.g. `Fragaria × ananassa`, OTT 3904118) have OTT IDs that are "pruned" from the synthetic tree. The fix is to use the parent genus OTT ID instead (e.g. `208027` for `Fragaria`). You'll know this happened if the build fails with an error like `"node_id 'ott<id>' was not found! pruned_ott_id"`.
- **No image from any automated source**: If `fill-image-urls.mjs` reports `✗ No image found`, find an appropriate image URL on Wikimedia Commons and paste it directly into the `image_url` column.
- **Wrong image**: The automated lookup sometimes picks a less-than-ideal representative image (especially for higher taxa via recursive descent). Replace the `image_url` with a better one by hand.
- **TNRS returns the wrong taxon**: Occasionally the name resolution picks a different organism than intended (e.g. a homonym in a different kingdom). Check the OTT ID at <https://tree.opentreeoflife.org/taxonomy/browse?id=OTTID> and replace it manually if it's wrong.

**Rule of thumb**: If a problem is a weird one-off, fix it by hand in `species.csv`. If it's a systematic issue (e.g. a whole class of names failing), fix it in the scripts instead.

## Meta: Revisit This Document

**This file (INGRESS.md) should itself be revisited each time you ingress new species.** If you discover new edge cases, new failure modes, or better workflows, update this document so the next person benefits.
