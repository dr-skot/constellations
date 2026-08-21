# Fact-check of the finding guides and the blurbs

Closes the content-correctness pass that the guide editorial pass and the unslop pass both
deferred. Both of those were about voice and deliberately left every number, date and
attribution untouched. This one checks whether the claims are true.

Covers `js/finding-guides.json` (338 steps across 88 constellations) and
`js/constellation-blurbs.json` (88 blurbs), read end to end. Roughly 240 steps and blurbs
carry a checkable claim. Everything below is the residue: the claims that turned out to be
wrong, contradictory, imprecise, or true today and false in ten years.

Date of the pass: 2026-08-20.

## Corrections applied

Twenty-eight in the guides, seven in the blurbs. Each one changes a fact and leaves the
sentence's rhythm alone.

### Guides

| Constellation | Was | Now | Source |
| --- | --- | --- | --- |
| Andromeda 1 | "the most distant object visible to the naked eye" | "the nearest big galaxy to our own" | M33 is farther and is the object usually cited for the naked-eye record. Also contradicted two other steps, see below. |
| Antlia 1 | "in the southern spring sky" | "in the far southern sky" | February to April is southern autumn, and the next step says February to April. Seasonal framing is against the editorial rules anyway. |
| Antlia 2 | "invisible north of about 45°N" | "its southern end never rises at all north of about 50°N" | Antlia spans declination −24° to −40°. Its northern end clears the horizon as far up as +66°. |
| Aquarius 3 | "the closest planetary nebula to Earth" | "one of the closest planetary nebulae" | Sh 2-216 is closer at about 420 ly. [Wikipedia](https://en.wikipedia.org/wiki/Sh_2-216) |
| Aquarius 3 | Helix ring "larger than a full moon" | "nearly as wide as a full moon" | Main ring about 16', outer halo 25 to 28', against the Moon's 31'. [constellation-guide](https://www.constellation-guide.com/helix-nebula-ngc-7293-caldwell-63-in-aquarius/) |
| Dorado 1 | "the Swordfish" | "the Dolphinfish" | Matches the blurb and all four diagram-source data files, which already gloss it that way. Title Case per the guide-opener convention, see below. |
| Camelopardalis 2 | "the third largest constellation by area" | "one of the largest constellations by area" | 757 sq deg, 18th of 88. [constellation-guide](https://www.constellation-guide.com/constellation-list/camelopardalis-constellation/) |
| Camelopardalis 3 | "the giraffe that carried Rebekah to Isaac" | Plancius drew a giraffe; Bartsch later read it as the camel | Plancius drew a giraffe. The Rebecca reading is Jacob Bartsch's later gloss, and Genesis 24 has camels. [Star Tales](http://www.ianridpath.com/startales/camelopardalis.html) |
| Canis Major 3 | Adhara "nearly 30 times as far away" | "about 50 times" | Sirius 8.6 ly, Adhara about 430 ly. [Star Facts](https://www.star-facts.com/adhara/) |
| Capricornus 4 | "Neptune was first spotted in Capricornus in 1846" | sentence removed | Galle found Neptune in Aquarius. [Astronomy.com](https://www.astronomy.com/science/neptunes-discovery/) |
| Carina 3, Puppis 3, Vela 3 | Argo Navis split "in 1755" | "in 1756" | 1756 is the published division; 1763 is the posthumous catalogue with the Latin names. Nothing happened in 1755. [Star Tales](http://www.ianridpath.com/startales/carina.html) |
| Centaurus 4 | "Menkent marks the Centaur's head" | "the Centaur's shoulder" | From Arabic *mankib*, shoulder. [Star Facts](https://www.star-facts.com/menkent/) |
| Columba 4 | "A supernova ... hurled it out" | two binary stars collided and flung it out | The binary-supernova idea was superseded. Hoogerwerf traced AE Aur, μ Col and ι Ori back to a binary-binary encounter 2.5 Myr ago. [ApJ 544 L133](https://ui.adsabs.harvard.edu/abs/2000ApJ...544L.133H) |
| Cygnus 3 | Deneb "roughly 2,600 light-years" | "somewhere between 1,600 and 2,600", too bright for Gaia | The distance is genuinely unmeasured, and the blurb said 1,500. [Sky & Telescope](https://skyandtelescope.org/astronomy-news/meet-deneb-the-bright-but-distant-star/) |
| Dorado 3 | LMC "about seven degrees" | "about ten degrees, twenty times the width of the full Moon" | 10.75° × 9.17°. [Wikipedia](https://en.wikipedia.org/wiki/Large_Magellanic_Cloud) |
| Eridanus 2 | "nearly a third of the sky from end to end" | "some 60° from end to end" | Declination +0° to −58°. A third of the sky would be 120°. |
| Horologium 3 | the pendulum clock "first made accurate navigation at sea possible" | it was hopeless at sea; longitude waited for Harrison | Pendulum clocks never became viable marine timekeepers. Huygens himself gave up on the idea. [World History Encyclopedia](https://www.worldhistory.org/article/2197/harrisons-marine-chronometer/) |
| Indus 3 | Epsilon Indi "one of the nearest Sun-like stars" | "an orange dwarf just 12 light-years away" | K5V, noticeably cooler and dimmer than the Sun. [Star Facts](https://www.star-facts.com/epsilon-indi/) |
| Libra 4 | Methuselah Star "around 13.7 billion years" | early estimates beat the universe; current figure about 12 billion | The 2013 figure of 14.46 Gyr was revised down to about 12 Gyr in 2021. [arXiv 2105.11311](https://arxiv.org/pdf/2105.11311) |
| Lynx 3 | "the only star brighter than fourth magnitude" | "much the brightest star in the constellation" | 38 Lyncis is magnitude 3.8, so there were two. |
| Monoceros 4 | Rosette "the size of a full moon" | "more than twice the width of a full moon" | 1.3° across. [Wikipedia](https://en.wikipedia.org/wiki/Rosette_Nebula) |
| Musca 3 | the Apis mistake "stuck for two centuries" | "stuck for 150 years, until Lacaille put the fly back in 1752" | Bayer 1603 to Lacaille 1752. [Star Tales](http://www.ianridpath.com/startales/musca.html) |
| Perseus 5 | "hundreds of young blue and red supergiants" | hundreds of blue stars, a scattering of red supergiants | The Double Cluster has a handful of red supergiants, not hundreds. |
| Phoenix 3 | Herodotus tells of the burning cinnamon nest | Herodotus has the bird carrying its dead parent; the fire is Ovid and Pliny | Histories 2.73 has no immolation. |
| Sculptor 3 | Lacaille's 14, "all named after instruments" | "all but one" | Mensa is a mountain. [Star Tales](http://www.ianridpath.com/startales/startales1d.html) |
| Caelum 3, Pyxis 1 | "14 instrument constellations" | "14 constellations" | Same Mensa exception. |
| Cetus 5 | Mira "at maximum outshines every other star in Cetus" | "at its best maxima it rivals Diphda" | Mira peaks near magnitude 2.0 only at exceptional maxima; typical maxima are near 3.5 and Diphda is 2.04. [Star Facts](https://www.star-facts.com/mira/) |
| Tucana 4 | 47 Tuc, "millions of stars some 13,000 light-years away" | "up to a million stars some 15,000 light-years away" | [NASA](https://science.nasa.gov/asset/hubble/globular-cluster-47-tucanae-2/) |
| Corona Borealis 4 | "It last blew in 1946, so the next one is due any time" | 1866 and 1946, next eruption close | Rewritten for rot, see below. |

### Blurbs

| Constellation | Was | Now | Source |
| --- | --- | --- | --- |
| Crux | "The Greeks never named it, since they lived too far north to see it" | they saw it and counted it as part of Centaurus; precession hid it later | Ptolemy catalogued those stars in Centaurus. Visible from Athens in 1000 BC, gone by AD 400. [Star Tales](http://www.ianridpath.com/startales/crux.html) |
| Puppis | Naos "tens of thousands of times brighter than the Sun" | "hundreds of thousands" | Bolometric luminosity around 376,000 to 500,000 solar. [Wikipedia](https://en.wikipedia.org/wiki/Zeta_Puppis) |
| Musca | mapmakers "spent a century flirting with renaming it Apis" | Bayer misread the Dutch and labelled it Apis; Lacaille put the fly back | The story ran the other way, and the guide already told it correctly. |
| Centaurus | Alpha Centauri "just 4.2 light-years away" | "4.4" | 4.34 for the bright pair. 4.24 is Proxima, which the same sentence goes on to name. |
| Tucana | 47 Tuc "millions of stars" | "up to a million" | As above. |
| Cygnus | Deneb "more than 1,500 light-years" | "at least 1,600" | Brought into line with the Cygnus guide. |
| Draco | Thuban pole star "around 3000 BC" | "around 2700 BC" | Matches the Draco and Ursa Minor guides. |
| Scutum | "That makes it one of the few constellations named for a real historical figure." | sentence removed | Scutum is named for Sobieski's shield, not for Sobieski. The claim also collided with Coma Berenices. The guide's sharper point, that Scutum is the only constellation commemorating a specific historical event, survives untouched. |

## Contradictions found

Cheap to find, embarrassing to ship. All but the last two are resolved by the corrections above.

1. Andromeda step 1 called M31 the most distant naked-eye object. Andromeda step 5 says "the
   farthest object most people will ever see" and Triangulum step 4 gives the same record to
   M33. Two of the three could stand; the flat superlative could not.
2. Camelopardalis step 2 called itself the third largest constellation. Ursa Major step 4
   correctly claims third place.
3. The Cygnus guide put Deneb at 2,600 ly, the Cygnus blurb at 1,500. Same star, factor of 1.7.
4. The Horologium guide credited the pendulum clock with solving navigation at sea. The
   Horologium blurb says it made accurate astronomy possible, which is right. The blurb won.
5. The Musca guide and the Musca blurb told opposite versions of the Apis naming. The guide
   was right.
6. The Crux blurb said the Greeks could not see the Southern Cross. The Centaurus guide says
   precession carried Centaurus below the European horizon, which is the correct account of
   the same fact.
7. Draco's blurb dated Thuban's reign to 3000 BC, the Draco and Ursa Minor guides to 2700 BC.
8. Caelum, Pyxis and Sculptor described all 14 of Lacaille's constellations as instruments.
   Mensa's own guide says it is named for Table Mountain.
9. The Dorado guide called it the Swordfish, the Dorado blurb the dolphinfish. Both renderings
   are in the literature, but all four diagram-source data files already gloss Dorado as "the
   dolphinfish," so the guide was the only holdout. It now says dolphinfish too.
10. The Coma Berenices guide says it is "the only modern constellation named after a real
    person." The Scutum blurb called Scutum "one of the few constellations named for a real
    historical figure." Scutum is named for the shield, not the king, so the Scutum sentence
    came out and Coma keeps the claim.

## True but rots

Claims phrased as a current record. Worth rewording so nobody has to recheck them every few years.

- **Corona Borealis, the Blaze Star.** Rewritten. The old text said "It last blew in 1946, so
  the next one is due any time," which needs a fresh reading every year. As of late June 2026
  T CrB is still quiet at magnitude 10.2, with June 2026 having been the statistically
  favoured date and February 2027 the next window. The new wording survives either outcome,
  but the moment it does erupt this step wants revisiting.
  [Sky Walk](https://starwalk.space/en/news/t-coronae-borealis-nova-star-exploding)
- **Pyxis 4**, T Pyxidis "has flared six times since 1890." True, and one more eruption makes
  it false. Consider "half a dozen times."
- **Pictor 3**, Beta Pictoris "two giant planets." Correct today. Direct imaging keeps finding
  more.
- **Ophiuchus 4**, "Four centuries later, no one has seen another." Ages gracefully until it
  doesn't, and then spectacularly.
- **Virgo blurb**, M87's black hole "the first ever photographed, in 2019." Fine, because it
  is dated. This is the pattern the others should follow.
- **Cygnus**, Deneb's distance. Now stated as a range with the reason. Gaia cannot measure it,
  so this will not settle soon.

## Left alone, for the maintainer to rule on

Each of these is imprecise rather than wrong, or is a simplification a beginner audience may
be owed. None were touched.

- **Andromeda 2**, Alpheratz called "Andromeda's brightest star." Hipparcos puts Alpheratz at
  2.06 and Mirach at 2.05. A coin flip that most references settle in Alpheratz's favour.
- **Canis Major 2**, "Sirius marks the dog's shoulder." Ptolemy put it in the mouth, and most
  figures draw it at the head.
- **Circinus 3**, "The whole constellation fits in a single binocular field." 93 sq deg is
  roughly 10° across; a binocular field is 5° to 7°. The three main stars nearly fit.
- **Auriga 3**, Epsilon Aurigae's "vast disc of unknown material." The 2009 to 2011 campaign
  identified it as a dusty disc of sand-grain-sized particles around a B star. The mystery
  framing is a generation out of date.
- **Lepus 4**, Hind's Crimson Star "visible to the naked eye." Only near maximum, at 5.5.
- **Hydrus 3**, Beta Hydri as the Sun "in about a billion years." Beta Hydri is about 6.4 Gyr
  old against the Sun's 4.6, so two billion is closer.
- **Piscis Austrinus 1**, "older than its zodiac neighbor Pisces." Both are Babylonian. I could
  not source the ordering.
- **Draco 5**, Minerva hurling the serpent "during the war with the Titans." Hyginus has the
  Giants. Ara's guide correctly uses the Titanomachy for a different story, so the two sit
  oddly together.
- **Ursa Major 4**, "No other star figure has roots that deep." Rests on the Palaeolithic
  cosmic-hunt hypothesis, which is contested and not the sort of thing a superlative suits.
- **Vela 4**, "the nearest known supernova remnant." Vela is the standard answer at about
  800 ly, but Antlia and Vela Junior are candidates. "One of the nearest" is safer.
- **Triangulum Australe 1 and 2**, "equilateral" and the other two stars "nearly as bright" as
  Atria. Atria is 1.91, the others 2.85 and 2.89, a factor of about 2.4 in brightness.
- **Taurus blurb**, the Hyades as "the nearest star cluster to Earth." Nearest open cluster.
  The Ursa Major moving group is closer.
- **Vela blurb**, "Several of its stars also form the False Cross." Two of the four; the other
  two are Carina's, as both guides correctly say.
- **Indus 3**, brown dwarfs "larger than any planet." Heavier, not larger. They are about
  Jupiter's size.
- **Aquarius 2**, "Sadalsud." The IAU spelling is Sadalsuud.
- **Antlia 3**, NGC 2997 "about 40 million light-years." Estimates run from 25 to 40.

## The casing convention in the opener slot

Not a fact, but it came up while fixing Dorado and was never written down, so here it is.

The two files cap the epithet differently, and both are right for what they are.

Guide openers put the epithet in a label slot after the constellation name, and 68 of the 71
use Title Case: "Let's find Musca, the Fly." The three exceptions are all longer descriptive
clauses rather than epithets, and those stay lowercase: "Let's find Cetus, the sea monster
from the Andromeda myth." The rule is short epithet, Title Case; descriptive phrase,
lowercase.

Blurbs put the same idea in running prose, and lowercase it: "Musca is the fly." Genuine
proper names keep their capitals there, which is why the Crux blurb has "the Southern Cross"
and the Corona Australis blurb has "the southern crown."

Dorado was briefly lowercased to "the dolphinfish" during this pass, which broke the guide
rule by importing the blurb's casing. It is back to "the Dolphinfish."

## Method

Every step and blurb was read in full, not sampled. Claims were sorted into superlatives,
attributions, dates, distances and periods, then checked. The superlatives were the richest
seam, as the ticket predicted: of the 28 guide corrections, 11 are superlatives that were
either never quite true or have quietly gone stale.

Sources are linked inline above. Where a claim rests on a single primary paper rather than a
reference work, the paper is cited instead.
