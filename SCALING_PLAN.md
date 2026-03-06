# Scaling Cat Bunny Railroad to ~700 Organisms

## Target Audience: 6-Year-Olds

This plan describes how to grow the organism list from 15 to ~700 entries while
keeping the app fun and accessible for young children.

---

## 1. Curating the Organism List

### 1.1 Selection Criteria

Every organism should pass these filters:

| Filter | Why |
|--------|-----|
| **Recognizable** | The child has seen it in real life, at a zoo, in a book, or on TV |
| **Simple common name** | One or two easy-to-read words (e.g. "polar bear", not "Ursus maritimus") |
| **Has an image** | OneZoom or another CC-licensed source provides a photo |
| **Taxonomically valid** | Has an OTT ID in Open Tree of Life |
| **Non-scary framing** | Name and image are age-appropriate (a "cobra" is fine; graphic predation photos are not) |

### 1.2 Recommended Categories (~700 total)

Organise the list into categories a child understands:

| Category | Example organisms | Target count |
|----------|-------------------|--------------|
| **Pets** | cat, dog, goldfish, hamster, rabbit | ~15 |
| **Farm animals** | cow, horse, pig, sheep, chicken | ~18 |
| **Big cats** | lion, tiger, cheetah, leopard | ~10 |
| **Bears** | polar bear, grizzly bear, panda | ~8 |
| **Monkeys & apes** | gorilla, chimpanzee, orangutan | ~15 |
| **Ocean mammals** | dolphin, blue whale, seal, walrus | ~14 |
| **African animals** | elephant, giraffe, zebra, hippo | ~15 |
| **Deer & hooved animals** | deer, moose, elk, bison, camel | ~12 |
| **Forest animals** | fox, wolf, raccoon, squirrel, beaver | ~20 |
| **Small & unusual mammals** | bat, platypus, capybara, sloth | ~15 |
| **Australian animals** | kangaroo, koala, wombat, quokka | ~10 |
| **More wild mammals** | fennec fox, ocelot, kinkajou | ~20 |
| **Birds of prey** | eagle, owl, hawk, falcon | ~12 |
| **Water birds** | penguin, pelican, flamingo, puffin | ~14 |
| **Tropical birds** | parrot, toucan, macaw, hornbill | ~12 |
| **Garden & common birds** | robin, blue jay, cardinal, crow | ~18 |
| **Flightless & other birds** | ostrich, emu, kiwi, roadrunner | ~12 |
| **Lizards** | chameleon, gecko, iguana, Komodo dragon | ~12 |
| **Snakes** | python, cobra, rattlesnake, boa | ~12 |
| **Turtles & crocs** | sea turtle, tortoise, alligator, crocodile | ~12 |
| **Frogs & salamanders** | frog, toad, axolotl, newt | ~14 |
| **Freshwater fish** | goldfish, trout, salmon, bass, piranha | ~18 |
| **Saltwater fish** | clownfish, tuna, seahorse, swordfish | ~16 |
| **Sharks & rays** | great white shark, hammerhead, manta ray | ~12 |
| **Butterflies & moths** | monarch butterfly, luna moth | ~10 |
| **Beetles** | ladybug, firefly, stag beetle | ~10 |
| **Bees, wasps & ants** | honeybee, bumblebee, ant | ~10 |
| **Dragonflies & other insects** | dragonfly, praying mantis, cricket | ~20 |
| **Spiders & scorpions** | garden spider, tarantula, scorpion | ~10 |
| **Crabs, lobsters & shrimp** | crab, lobster, shrimp, pill bug | ~10 |
| **Snails & worms** | snail, slug, earthworm | ~8 |
| **Octopus & squid** | octopus, squid, cuttlefish, nautilus | ~8 |
| **Jellyfish & coral** | jellyfish, sea anemone, coral | ~8 |
| **Starfish & urchins** | starfish, sea urchin, sea cucumber | ~8 |
| **Clams & shellfish** | clam, mussel, oyster, conch | ~6 |
| **Trees** | oak, maple, pine, palm, redwood | ~30 |
| **Flowers** | rose, sunflower, daisy, tulip, orchid | ~25 |
| **Vegetables & crops** | tomato, corn, wheat, carrot, potato | ~25 |
| **Fruits** | strawberry, pineapple, cherry, grape | ~12 |
| **Cacti & succulents** | saguaro cactus, aloe vera | ~8 |
| **Aquatic plants** | water lily, kelp, cattail | ~6 |
| **Ferns & mosses** | fern, moss, horsetail | ~6 |
| **Carnivorous plants** | Venus flytrap, sundew, pitcher plant | ~5 |
| **Mushrooms & fungi** | mushroom, chanterelle, yeast | ~12 |
| **Other marine invertebrates** | mantis shrimp, coconut crab, nudibranch | ~15 |
| **More plants** | sensitive plant, cotton, coffee, vanilla | ~15 |

### 1.3 How to Build the List

A starter seed list is provided in **`scripts/kid-friendly-species.json`**.
Each entry has:

```json
{
  "common_name": "polar bear",
  "scientific_name": "Ursus maritimus",
  "category": "Bears"
}
```

Use the companion script **`scripts/generate-species-list.mjs`** to:

1. Read the seed list
2. Resolve each scientific name → OTT ID via the
   [Open Tree TNRS API](https://opentreeoflife.github.io/develop/tnrs)
3. Write a new `species.csv` (name, ott_id, image_url)
4. Then run `node scripts/fill-image-urls.mjs` to fetch images

```bash
# Step 1 – resolve names to OTT IDs
node scripts/generate-species-list.mjs

# Step 2 – fetch images from OneZoom
node scripts/fill-image-urls.mjs
```

### 1.4 Handling Failures

Some names won't resolve cleanly:

| Problem | Solution |
|---------|----------|
| TNRS returns no match | Check spelling; try alternate scientific name |
| Taxon is "broken" (non-monophyletic) | Existing `build-data.js` already handles this with `≈` badges |
| No image on OneZoom | `fill-image-urls.mjs` does recursive descent; accept placeholder if still missing |
| Name too hard for kids | Replace with simpler synonym in seed list |

---

## 2. Technical Scaling

### 2.1 API Constraints

| API | Current usage | At 700 organisms | Mitigation |
|-----|---------------|-------------------|------------|
| **Open Tree induced_subtree** | 15 OTT IDs per POST | 700 IDs per POST | API accepts large arrays; tested up to 1000+ IDs. No change needed. |
| **Open Tree MRCA** | ~5 calls (resolve internal nodes) | ~100–200 calls (more internal nodes) | Batch where possible; add concurrency (5 at a time). |
| **Open Tree TNRS** | Not used at build time | 700 names to resolve (one-time) | New script batches 250 names per request (API limit). |
| **OneZoom node_images** | 15 calls (1 per organism) | 700 calls | Add concurrency (5–10 parallel requests). Cache results. |

### 2.2 Build Pipeline Changes

#### `build-data.js` — resolve internal node names in parallel

Currently `resolveNodeNames` makes sequential API calls. With a larger tree
there will be many more unnamed `mrcaott…` internal nodes.

**Change:** resolve up to 5 nodes concurrently using a simple work queue.

#### `fill-image-urls.mjs` — parallel image fetching

Currently processes one organism at a time. At 700 organisms this is very slow.

**Change:** process up to 5 organisms concurrently. Add a progress counter.

### 2.3 Data Size

| Asset | 15 organisms | 700 organisms (estimate) |
|-------|--------------|--------------------------|
| `species.json` | ~2 KB | ~80 KB |
| `tree.json` | ~1 KB | ~50 KB |
| Total images loaded | 15 × ~30 KB = 450 KB | 700 × ~30 KB = 21 MB (lazy-loaded) |

Images are already `loading="lazy"` in the current code, so only visible images
are fetched. No change needed for image loading strategy.

### 2.4 UI Changes

#### Autocomplete

The trie-based autocomplete is O(k) per lookup (k = prefix length) and handles
700 items easily. **No change needed.**

However, consider limiting the dropdown to **10–15 suggestions** at a time to
avoid an overwhelming list when the prefix is short (e.g. typing "s" matches
many organisms). The current code already shows all matches — add a `.slice(0, 12)`.

#### "All organisms" grid on homepage

Showing 700 organism cards on the homepage at once is viable because images use
`loading="lazy"`. However, consider:

- **Group by category** with collapsible sections, or
- **Only show the search interface** instead of listing all organisms, or
- **Paginate** with a "Show more" button

#### MRCA clade results

When two distant organisms are selected (e.g. cat + sunflower → Eukaryota),
the result clade could include *all* 700 organisms. This is actually correct
and educational ("everything alive is related!"), but:

- Show the **count** prominently: "All 700 organisms are in this group!"
- Consider a **"Show more" button** that reveals organisms in batches of 50
- Group results by sub-clade if possible

---

## 3. Implementation Roadmap

### Phase 1: Seed List & Resolution Script ✅ (this PR)

- [x] Create `scripts/kid-friendly-species.json` — curated list of ~700 organisms with common names, scientific names, and categories
- [x] Create `scripts/generate-species-list.mjs` — resolves scientific names to OTT IDs via TNRS API, outputs `species.csv`
- [x] Document the workflow in this plan

### Phase 2: Build Pipeline Optimisation

- [ ] Add concurrency to `resolveNodeNames` in `build-data.js` (5 parallel MRCA API calls)
- [ ] Add concurrency to `fill-image-urls.mjs` (5 parallel OneZoom lookups)
- [ ] Add progress logging (`Processed 42/700 organisms...`)
- [ ] Cache API responses locally to speed up re-runs

### Phase 3: UI Scaling

- [ ] Limit autocomplete dropdown to 12 suggestions
- [ ] Replace "All organisms" homepage grid with categorised or search-only view
- [ ] Add "Show more" button to clade results (show 50 at a time)
- [ ] Consider grouping results by sub-clade for very large result sets

### Phase 4: Polish & Testing

- [ ] Manual review: remove any organisms with bad images or confusing names
- [ ] Kid testing: try the app with actual 6-year-olds and iterate
- [ ] Add pronunciation hints or fun facts (future enhancement)
- [ ] Performance testing: verify page load time is acceptable

---

## 4. Running the Scripts

```bash
# 1. Generate species.csv from the seed list
#    (calls Open Tree of Life TNRS API)
node scripts/generate-species-list.mjs

# 2. Fill in missing image URLs
#    (calls OneZoom API — may take a while for 700 organisms)
node scripts/fill-image-urls.mjs

# 3. Build the website
#    (fetches phylogenetic tree, generates JSON data, bundles with Vite)
cd website && npm run build
```

## 5. Key Design Decisions

### Why scientific names in the seed list?

The Open Tree TNRS API resolves scientific names much more reliably than common
names. The `common_name` field in the seed list is what users see in the app;
the `scientific_name` is only used during the one-time OTT ID resolution step.

### Why not use a pre-existing list?

There's no single authoritative list of "organisms 6-year-olds know". Children's
knowledge varies by culture, geography, and exposure. The seed list is hand-curated
to cover organisms from popular children's books, zoos, aquariums, nature shows,
and backyards worldwide. It's designed to be edited — add or remove organisms
as needed.

### Why 700 and not more?

700 gives broad coverage without overwhelming the search interface. A child can
type any animal they've heard of and likely find it. Going beyond 1000 would
require more sophisticated UI (faceted search, categories) and significantly
longer build times.
