# Weapon effects model

An educational effects calculator inside a puzzle game: fits and scaling laws from open literature, not a hydrocode. Everything is a pure function of its inputs. The code is in `src/lib/game/effects.ts` and `weapons.ts`, and the anchors below are tested in `generator.test.ts`.

Confidence labels: **published** means stated in a source that was read. **read from plot** means taken by eye from a printed figure, good to a few percent at best. **fit** means this project tuned it. **estimate** means no source gave it, and it is a judgement.

## Sources read

| Short name | Document | Used for |
| --- | --- | --- |
| G&D | Glasstone & Dolan, *The Effects of Nuclear Weapons*, 3rd ed., 1977 (DTIC ADA087568 scan) | Thermal tables, burn thresholds, prompt gamma curves, fallout height limit, rainout, Table 9.93, anchors |
| Brode | H. L. Brode, *Airblast from Nuclear Bursts: Analytic Approximations*, PSR 1419-3, 1987 | Overpressure fit (eq. 62), transmittance form (eq. 86) |
| Miller | C. F. Miller, *Biological and Radiological Effects of Fallout from Nuclear Explosions*, ch. 3, URS 702-1, 1969 (DTIC AD0688940) | Fallout field and cloud geometry |
| Hanifen | D. W. Hanifen, *Documentation and Analysis of the WSEG-10 Fallout Prediction Model*, AFIT 1980 (DTIC ADA083515) | Dose per unit H+1 rate (eq. 27), half-hour arrival floor, comparison |
| OTA | Office of Technology Assessment, *The Effects of Nuclear War*, 1979 | Blast anchors, lethal dose, fallout comparison |
| Sublette | C. Sublette, *Nuclear Weapons FAQ* and archive pages, nuclearweaponarchive.org | Yields, fission figures, neutron weapon ranges, burn ranges, EMP horizon |
| Wellerstein | blog.nuclearsecrecy.com posts on NUKEMAP's fallout | Confirms NUKEMAP uses Miller's scaling system, and the Bravo and Tsar comparison |

Not retrieved: Bridgman's *Introduction to the Physics of Nuclear Weapons Effects*, the NUKEMAP FAQ text and code, and FM 3-3. Nothing here is attributed to them.

## Airblast

**Method.** Brode eq. 62, peak overpressure against scaled ground range and scaled burst height over an ideal surface, with cube-root scaling. It is sampled once into a 96 by 72 grid of ln(psi) so per-cell lookups stay cheap. Coefficients were read from the report's text, and the Fortran in its appendix is a second copy. The appendix adds a small correction term `BB` that eq. 62 lacks; this code follows eq. 62.

**Validity.** Sea-level ambient, ideal surface, no precursor or terrain. Values are floored at 0.1 psi, because the fit goes negative beyond its range. Cube-root scaling breaks down when the blast is large against the atmosphere's scale height, which the model ignores, so the 1 Gt and 10 Gt entries are extrapolations.

| Anchor | Published | Model | Off by |
| --- | --- | --- | --- |
| G&D §3.73: 100 kt, 2320 ft, at 1860 ft | 50 psi | 46.8 psi | -6% |
| G&D §3.73: 125 kt, 4 psi reach from 5500 ft | 13,000 ft | 12,640 ft | -3% |
| OTA Table 3: 1 Mt at 8000 ft, 20 psi | 1.3 km | 1.39 km | +7% |
| same, 10 psi | 4.8 km | 4.03 km | -16% |
| same, 5 psi | 7.0 km | 6.53 km | -7% |
| same, 3 psi | 9.5 km | 8.86 km | -7% |
| same, 1 psi | 18.6 km | 18.72 km | +1% |
| Sublette 5.6.2: 1 kt optimum, 20 / 10 / 5 / 3 / 1 psi | .28 / .45 / .71 / 1.0 / 2.2 km | .256 / .408 / .662 / .959 / 2.30 km | -9, -9, -7, -4, +5% |
| Hiroshima, 15 kt at 580 m, severe damage | about 1.7 km | 1.60 km | -6% |

The fit runs a few percent under G&D-era curves near 5 to 20 psi. Brode's own comparison puts most disagreement with his calculation sets within 20%, and test scatter is above 15% in range. The optimum height, `optimumHobM`, is 270 m per cube-root kiloton from this fit, up from a previous 240.

The fatality and structure tables by overpressure are unchanged from the earlier OTA-based bands (estimate). They were not re-derived.

## Thermal

**Method.** G&D eq. 7.96.4, Q = 3.07 f W T / D² with D in miles.

- f: G&D Table 7.88 by yield and burst height (published). Near the ground, Table 7.101 (published). Its columns collapse onto the 1 kt column when height is scaled by cube root, so one column is used; the collapse was checked to within about 0.02 and is this project's observation.
- T: Brode eq. 86, (1 + 1.9 s) exp(-2.9 s) with s = path / visibility (published). G&D says most attenuation lies in the lowest air, so a burst above 15,000 ft counts only the share of its path below that height (simplification).
- Burn threshold: third-degree, medium skin, G&D Fig. 12.64 (read from plot).
- Weather: visibility CLEAR 12 mi and HAZE 6 mi from G&D Table 7.12. OVERCAST 12, RAIN 2.5, SNOW 6 are estimates. Cloud layers run from 2000 ft (G&D §9.68) to an estimated top. A burst under the layer gets G&D's factor of 1.5 for reflection, and a burst over it gets a loss inside Brode's 0.1 to 1 range (estimate: 0.3, or 0.1 in rain). Snow on the ground adds another 1.5 (G&D §7.100).

Under the previous code overcast always cut thermal range, which was wrong for a burst below the cloud. G&D says the opposite.

| Anchor | Published | Model | Off by |
| --- | --- | --- | --- |
| G&D §7.43: 1 Mt air burst, 7 mi slant | 8 cal/cm² | 8.52 | +7% |
| Sublette 5.6.1.1: third-degree, 20 kt | 2.7 km | 2.42 km | -10% |
| same, 1 Mt | 12 km | 10.35 km | -14% |
| same, 20 Mt | 39 km | 29.7 km | -24% |

The long-range shortfall against Sublette comes from following G&D's 12-mile visibility. Sublette's table does not state its visibility.

## Prompt radiation

**Method.** Sublette 5.6.3.3, 1000 rad at 700 Y^0.19 m slant range, converted to ground range.

| Anchor, 1000 rad gamma slant range | G&D Fig. 8.33 (read from plot) | Model | Off by |
| --- | --- | --- | --- |
| 1 kt | 750 yd | 766 yd | +2% |
| 100 kt | 1870 yd | 1836 yd | -2% |
| 1 Mt | 2650 yd | 2844 yd | +7% |
| 10 Mt | 4250 yd | 4405 yd | +4% |

**Enhanced radiation.** The W70's radius multiplier went from 2.2 to 1.5. Sublette gives 600 rad on unprotected soldiers at 1350 m for a 1 kt neutron warhead against 900 m for pure fission. The same page's anti-tank ranges at 8000 rad give a ratio of 1.9, and the FAQ's section 5 quotes a `constant_rad_1000` of 620 m for neutron bombs, which sits awkwardly beside the other figures and was not used.

**Simplifications.** Gamma curves stand for total dose: neutrons are not modelled separately. Fission share does not change the range, though G&D §8.130 scales the fission product gamma with fission yield, so Tsar Bomba's radiation ring is too large. G&D's halving of prompt neutrons for contact bursts is ignored. Air density at burst height is ignored.

## Fallout

**Method.** Miller's Simplified Fallout Scaling System, ch. 3. It is the model Wellerstein describes NUKEMAP using, read here from Miller directly.

- **Lofting.** Cap altitude, half-thickness and radius come from eqs. 3.22 to 3.24, below 30 kt from Table 3.4. Stem and cap are separate sources whose patterns add, as Miller does.
- **Pattern.** Scaling functions for the ridge and tip of the stem and the upwind tip, peak and far tip of the cap. Each contour's size runs linearly in log intensity, so the contour through any point has a closed-form solution (a quadratic for the cap, except a short bisection upwind of the point where the upwind tip changes slope). That gives a continuous H+1 field at about 34 ns per evaluation. The stem contours are simplified to a stadium around the ridge rather than Miller's exact half-ellipse and circle.
- **Wind at height.** Miller and G&D take one effective wind. Following G&D §9.84, it is the mean of the average winds from the ground to the cloud's base and top; the stem uses the average to the cap's base. `Weather.windKmh` is read as the low-level wind, and an estimated mid-latitude profile (jet near 11 km, weak above 20 km) supplies the rest. That profile is not from a cited table. Effective wind is held to 7.5 to 50 mph, the fits' stated range.
- **Directional shear.** Not modelled apart from what Miller's widths already contain. Everything travels along one bearing.
- **Fission.** G&D §9.94: contour shapes follow total yield, rates scale with fission fraction.
- **Height of burst.** Cutoff is G&D eq. 2.128.1, 180 W^0.4 ft, ±30%. Between ground and cutoff no source gives a curve, so coupling is the share of a fireball of that radius the ground would cut off, (1 - λ)²(2 + λ) / 2 (estimate). OTA states negligible immediate fallout above a fireball radius, which agrees.
- **Dose and decay.** Rates are H+1 reference rates. Deaths come from dose, not rate: Miller's observed rate times 1.33 for true air rate, times Hanifen eq. 27's factor for arrival time, which is where t^-1.2 decay enters, times 0.2 for shelter (estimate from G&D Table 9.120's ranges). Arrival time is from G&D §9.91, floored at WSEG's half hour. Fatality is OTA's 300 rem 10%, 450 50%, 600 90%, with G&D Table 12.108 at the ends. This lowers fallout deaths at moderate rates a good deal against the old table, which gave 30% at 100 rad/h.
- **Rainout.** G&D §9.68 to §9.73. The share of the cap under a 33,000 ft rain top, times 75% from Table 9.74a, comes down within the scavenging time plus the fall time at 1000 ft/min (200 for snow), packed into a shorter pattern with the same activity. Stems are not scavenged (§9.67). Snow's top of 20,000 ft, and 25% of an air burst's debris being available (§9.73 calls this unverified), are estimates. So is applying the same rule to clouds of any yield.

**Corrections.** Table 3.1 in the scan gives K = 46.12 and 1345 for I5 and I6 under the cloud. Those overshoot I6 in Miller's own Table 3.4 by a factor of 4.5 and jump at the branch. They are replaced by 3.4 (continuity) and 300 (fit to Table 3.4). This affects only high yields in slow winds. Worth checking against a cleaner copy.

**Validity.** Fits run from 30 kt to 100 Mt and 10 to 50 mph, land surface. Below 30 kt the shape is scaled from Table 3.4, and below 1 kt (Mk-54, low B61) that table's slope is extrapolated: an estimate. Above 100 Mt (Gnomon, Sundial) the power laws are simply extrapolated, ignoring curvature of the earth.

### Against other published models

Reach of the contour in statute miles, 1 Mt, 100% fission, 15 mph:

| rad/h at H+1 | G&D Table 9.93 | Miller, as implemented | WSEG-10 (prototype, 0.3 kn/kft shear) |
| --- | --- | --- | --- |
| 1000 | 40 | 58 | 23 |
| 100 | 199 | 125 | 124 |
| 10 | 537 | 192 | 292 |
| 1 | 895 | 259 | 492 |

Maximum width of the same contours: G&D 7, 24, 55, 91; Miller 8, 28, 48, 67. Miller's widths track G&D closely, but its far contours are much shorter. This is genuine disagreement in the literature and these are all idealised means. OTA's 7-day unsheltered contours for the same case, measured off its Fig. 2 at 3000, 900, 300 and 90 rem at about 30, 88, 160 and 239 miles, compare to model doses of about 10,000, 850, 55 and 3 rem. So Miller is hotter than OTA close in and much cooler far out. G&D is the closest of these to OTA at long range.

WSEG-10 was implemented from Hanifen's Appendix A subroutine for comparison, and it reproduces his sample output (0.01 Mt, 10 kn, 10 R/h contour: 60.3 nm against his 60.5, peak 1245 against 1238). It was not chosen for the game because it has no stem, which DNA 3168F calls a poor assumption below about 50 kt, and Hanifen reports it underestimates cloud height at low and high yields.

| Anchor | Published | Model | Off by |
| --- | --- | --- | --- |
| Miller Table 3.4, 100 kt to 100 Mt: X9, X7, Y8, I7 | as tabled | as tabled | under 2% on distance, under 8% on rate |
| G&D Fig. 9.96: 1 Mt cloud base, top (read from plot) | 35,000 / 65,000 ft | 41,000 / 63,000 ft | +17%, -3% |
| Sublette: Bravo cloud bottom, peak | 55,000 / 130,000 ft | 56,000 / 106,000 ft | +2%, -18% |
| G&D §9.104: Bravo contamination over 330 mi long | | 10 rad/h at 611 mi, 100 at 428 mi in a 24 km/h low-level wind | Longer |
| G&D §9.109: Rongelap 96 h dose, 3300 and 220 rad at 100 and 115 mi | | about 9300 and 6600 at 15 mph, unsheltered | +3x to +30x |

The Bravo dose comparison is the weakest. G&D warns the contours there are close to guesswork from a few points, the test was over water and wind shear was strong, and the two Rongelap sites differ by 15 times in 15 miles. A single smooth plume can't match that.

G&D §9.94 says H+1 rates over about 5000 rad/h are unlikely, while Miller's ridge reaches 35,000 at 100 kt in a very narrow band. It is left as Miller gives it, since nothing outside blast and thermal range depends on it.

### Salted weapons

`salted` remains a plain multiplier on activity, and that is not physical. Sublette gives fission products 15,000 times the intensity of Co-60 at one hour and roughly equal at six months. So cobalt barely changes H+1 rates or acute deaths: what it does is deny land for years, which this model has no time axis for. The multiplier stands in for that (estimate, marked in the code), and both values (2 for Poseidon, 5 for the cobalt device) are game choices. Public reports don't establish that Poseidon's warhead is salted at all.

## EMP

Footprint is the horizon arc from burst height, consistent with Sublette's 2500 km at 500 km (model 2445). The factor of 0.35 to 1 by yield is an estimate carried over from the old code. No published fit for it was found. Bursts above 30 km only, which also matches Sublette's stated threshold.

## Precipitation handling, summary

CLEAR and HAZE don't change fallout. OVERCAST doesn't either, since no rain falls out of it in this model. RAIN and SNOW scavenge as above, which also gives air bursts a small plume in the rain. The old `THERMAL_FACTOR` table is gone, replaced by visibility and cloud geometry.

## Weapons

Yields in kt. Fission is the top of the dial unless a range is shown.

| Weapon | Yield | Fission | Source | Confidence |
| --- | --- | --- | --- | --- |
| Mk-54 Davy Crockett | 0.01 to 0.02 | 1.0 | Sublette's bomb list: Mk-54 Davy Crockett 10, 20 t. He lists W54 as the 250 t Falcon warhead, so the catalogue uses Mk-54. | yield published, fission guide |
| W70 Mod 3 | 1 | 0.4 | Sublette FAQ 1.6: 60% fusion, 40% fission | published. Old value 0.25 was wrong |
| Little Boy | 15 | 1.0 | Sublette's bomb list: 15 to 16 kt. Pure fission | published |
| Fat Man | 21 | 1.0 | Sublette's bomb list: 20 to 23 kt in its first form. Pure fission | published |
| B61 Mod 12 | 0.3 to 50 | 1.0 to 0.5 | Yields, Sublette bomb list (0.3, 1.5, 10, 50). B61 page: 0.3 kt probably the unboosted primary. Between that and 50 kt, fit | yield published, curve inferred |
| W80 | 5 to 150 | 1.0 to 0.5 | Sublette: 5 kt and 150 to 170 kt, 5 kt presumably the primary. Real weapon has two settings, not a dial | yield published, curve inferred |
| W76 | 100 | 0.5 | Sublette: 100 (Mod 0), 90 (Mod 1). Fission by guide | yield published, fission guide |
| W87 | 300 to 475 | 0.5 | Sublette: 300, 475 (W87-1). Fission by guide | yield published, fission guide |
| W88 | 475 | 0.5 | Sublette. Fission by guide. His note about its jacket hints it could run higher | yield published, fission guide |
| RT-2PM Topol | 800 | 0.5 | Could not confirm the yield. Only a weak source, about 550 kt, turned up | low |
| B83 | 1 to 1200 | 1.0 to 0.5 | Sublette: low kt to 1.2 Mt. Curve inferred; 0.4 before was from memory | yield published, curve inferred |
| DF-5 | 4000 to 5000 | 0.5 | Only a Wikipedia mirror, marked citation needed | low |
| B53 | 9000 | 0.5 | Sublette: 9 Mt, with dirty and clean versions. Which fraction is unknown | yield published, fission guide |
| Castle Bravo | 15,000 | 0.667 | Sublette, Operation Castle: 10 Mt fission of 15; G&D §9.104 for the yield | published |
| R-36M | 18,000 to 25,000 | 0.5 | Yield from search results citing GlobalSecurity and Wikipedia, not read in full. Fission by guide | medium, fission guide |
| Status-6 Poseidon | 2000 | 0.5 | Open estimates cluster near 2 Mt, against Russian claims of far more. Old 0.6 had no source | low |
| Cobalt device | 1000 to 5000 | 0.5 | Theoretical. Szilard origin per Sublette. Cobalt replacing a fissile jacket would lower this | estimate |
| Tsar Bomba | 50,000 | 0.03 | Sublette: 97% fusion | published |
| Tsar Bomba full | 100,000 | 0.5 | Sublette: 50/50 at full yield | published |
| Gnomon | 1,000,000 | 0.5 | Yield per Wellerstein and Wikipedia via search. Fission unknown, guide used. Old 0.4 had no source | yield medium, fission estimate |
| Sundial | 10,000,000 | 0.5 | as above | as above |

Fission fractions between a dial's knots are interpolated in log yield. No public source gives them, and real weapons have a few fixed settings. Sublette's guide (100% under 100 kt, 50/50 above) stands in where nothing device-specific was found, which is most modern warheads: no public figure for the W76, W87, W88, B83 or the Russian and Chinese warheads was found.

Sundial's scaled optimum height, about 58 km, lies above the 30 km cutoff, so `optimumHobM` is capped at 29 km. That cap is a game choice, not a published optimum.
