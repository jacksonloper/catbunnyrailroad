# Upstream issues (Open Tree of Life)

Things we are working around locally that really belong upstream.  Each
entry names the workaround in this repo so it can be deleted once the
upstream fix lands.  File these with the Open Tree curators at
<https://github.com/OpenTreeOfLife/feedback/issues> (taxonomy problems)
or by editing the study in <https://tree.opentreeoflife.org/curator>
(phylogeny problems).

`node scripts/build-data.js` warns when a placement override looks like
a no-op, which is the signal that an entry below may be resolved.

| Ref | Problem | Our workaround | Remove when |
|-----|---------|----------------|-------------|
| OTL-1 | Theropods and Psittacosaurus are grouped with squamates | `placement_overrides.csv` rows for ott664349, ott4946063, ott4126864 | the synthetic tree nests them inside Archosauria |
| OTL-2 | Ankylosauridae and Diplodocidae are unplaced under Sauria | `placement_overrides.csv` rows for ott4946546, ott4946869 | the synthetic tree nests them inside Dinosauria |
| OTL-3 | Dinosauria is "broken" in the synthetic tree | none (consequence of OTL-1) | Dinosauria resolves to one node |
| OTL-4 | Triceratops and all of Ceratopsidae are pruned from synthesis | Psittacosaurus (ott4126864) stands in for Triceratops in the Dino Delight list | Triceratops (ott4947055) appears in the synthetic tree |
| OTL-5 | *Asteriornis maastrichtensis* ("Wonderchicken") is not in the OTT taxonomy | left out of the Dino Delight list | the name resolves in TNRS |

## OTL-1: theropods grouped with squamates

In the synthetic tree, `Tyrannosaurus rex` (ott664349), `Velociraptor`
(ott4946063) and `Psittacosaurus` (ott4126864) sit inside a node
(`mrcaott1662ott664349`) whose other members are lizards and snakes.
That node is supported by exactly one input tree, study **ot_1335**
(Langer, Bittencourt & Schultz 2011, "A reassessment of the basal
dinosaur *Guaibasaurus candelariensis*").  Open Tree records that the
node conflicts with two bird-origin studies (ot_1431, Hu et al. 2010,
and ot_1513), but ot_1335 outranks them.

Most likely cause: an outgroup tip in ot_1335 was mapped to a squamate
OTT taxon, or the tree was rooted on the wrong tip during curation.
The fix is to re-curate ot_1335 (check the outgroup mapping and
rooting), or to add and rank a modern dinosaur phylogeny that covers
these genera.

## OTL-2: Ankylosauridae and Diplodocidae unplaced

`Ankylosaurus` (ott4946546) and `Diplodocus` (ott4946869) hang directly
off Sauria.  No input phylogeny in the synthesis covers them, so their
only placement comes from the taxonomy backbone, whose parent for
both families is Dinosauria.  Because of OTL-1, Dinosauria is broken
(it resolves to Sauria), so the families lose their parent.  Fixing
OTL-1 may fix this on its own; otherwise a curated ornithischian and
sauropod phylogeny is needed.

## OTL-3: Dinosauria is broken

`tree_of_life/node_info` for Dinosauria (ott90215) returns Sauria
(ott329823).  Same for Coelurosauria (ott664351).  Consequence of
OTL-1: with theropods pulled next to squamates, Dinosauria is no
longer monophyletic in the synthesis.

## OTL-4: Ceratopsidae pruned

`Triceratops` (ott4947055), `Triceratops horridus`, `Triceratops
prorsus`, `Ceratopsidae` (ott4947034), `Torosaurus`, `Styracosaurus`,
`Centrosaurus`, `Chasmosaurus`, `Pachyrhinosaurus`, `Protoceratops` and
`Iguanodon` all exist in the OTT taxonomy but are pruned from the
synthetic tree (`induced_subtree` reports `pruned_ott_id`).  They carry
the `extinct` and `incertae_sedis` flags, which is presumably why they
are dropped.  `Psittacosaurus`, `Stegosaurus`, `Brachiosaurus` and
`Apatosaurus` carry the same flags and are kept, so the pruning looks
inconsistent rather than deliberate.  Ask for Ceratopsidae to be kept
in synthesis; then replace Psittacosaurus with Triceratops in the
Dino Delight list and drop the Psittacosaurus row from
`placement_overrides.csv` (adding a Triceratops row instead if it is
still misplaced).

## OTL-5: Asteriornis missing from the taxonomy

*Asteriornis maastrichtensis* Field et al. 2020 (the "Wonderchicken",
a Maastrichtian stem galloanseran) does not resolve in TNRS, even with
approximate matching.  It should come in through GBIF or the
Paleobiology Database.  Once it resolves and appears in the synthetic
tree, add it to `taxa.csv` and to the Dino Delight list.

## Not upstream, but related

Every extinct taxon we add is likely to need an entry here.  Living
taxa are covered by the molecular megatrees Open Tree ranks highly;
fossils are not.  Expect to add a `placement_overrides.csv` row for
each new fossil and an entry above describing what would let us delete
it.
