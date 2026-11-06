// All words in the post-strike report. Numbers come in already formatted, so a translation only has to
// mind the sentences. Facts here carry their source in the SOURCES list at the end.

export const BUTTON_LABEL = { en: "LEARN WHAT YOU'VE DONE", ru: 'УЗНАЙТЕ, ЧТО ВЫ НАТВОРИЛИ' };

export const EN = {
	title: "What you've done",
	close: 'Close',
	nav: { summary: 'Summary', map: 'Map', weapons: 'Each weapon', score: 'Your score', how: 'How it works', missing: 'Not counted', sources: 'Sources' },
	modelNote:
		'This is a game model built from open literature, not a prediction. Everything below is calculated from your plan by the same code that scored it. Where something comes from an estimate rather than a published figure, it says so.',

	sheet: {
		org: { sage: 'AN/FSQ-7 DIRECTION CENTRAL', pvo: 'VOZDUKH-1 AIR DEFENCE SYSTEM', paper: 'TARGET PLANNING STAFF' },
		form: { sage: 'LINE PRINTER OUTPUT. STRIKE EVALUATION', pvo: 'PRINTER LISTING. STRIKE EVALUATION', paper: 'POST-STRIKE WORKSHEET. CARBON COPY 2 OF 3' },
		stamp: { sage: 'EXERCISE ONLY', pvo: 'EXERCISE ONLY', paper: 'SECRET · EXERCISE ONLY' },
		exercise: 'EXERCISE',
		page: 'PAGE'
	},
	march: {
		injured: 'Injured',
		injuredRead: (total: string, blast: string, burns: string, sickness: string) => `Injured: ${total} survivors, an estimate. Blast ${blast} (OTA's shares by pressure), burns ${burns}, radiation sickness ${sickness}.`,
		key: { living: 'People in reach', hurt: 'Will be injured (estimate)', doomed: 'Will die', figure: 'Each figure' },
		head: 'The march',
		body: "This is drawn after Charles Minard's 1869 map of Napoleon's army in Russia, where the band's width is the army and its shrinking is the dead. Here the pale band is everyone your plan could reach, moving left to right through the hazards in the order they arrive. The dark vein along its underside is the people who will die, there from the first moment. At each hazard its share tears away, frays into one strand per warhead, and walks down into the rows of its dead. Places along the top are the worst hit, with their dead.",
		title: (map: string) => `Figurative map of the successive losses in people, ${map}`,
		legend: (perMm: string, perFigure: string) => `The width of each band shows the number of people, at about ${perMm} to the millimetre. Very thin wounds are drawn wider so they stay visible. Each figure below is ${perFigure}.`,
		reached: 'In reach',
		survive: 'Unhurt',
		untouched: (n: string) => `Another ${n} people on this map were out of reach.`,
		dead: 'dead',
		causes: { radiation: 'Radiation', burns: 'Burns', blast: 'Blast', firestorm: 'Firestorm', fallout: 'Fallout', cancer: 'Cancer' },
		scored: (n: string) => `${n} counted in your score`,
		fire: {
			burning: (area: string, deaths: string) => `Firestorm: the model finds one, over ${area}. It would begin within about half an hour and kill about ${deaths} more people. That is an estimate on top of your score.`,
			wind: 'No firestorm: the wind is too strong, so fires would run downwind as a conflagration instead. That is not counted.',
			wet: 'No firestorm: rain or snow keeps too much of it from catching at once.',
			fuel: 'No firestorm: the burn radius does not cover enough densely built ground.',
			none: ''
		},
		cancerNote: (n: string) => `Cancer: by the linear no-threshold model, about ${n} more deaths over the following decades, from fallout and prompt radiation at about 5% per sievert. It is the most disputed step at low doses, and it is not in your score.`,
		table: 'Graphic table of the dead, from the first second to decades later. Not to scale.',
		when: (cause: string, s: number | null) => (cause === 'firestorm' ? 'about 30 min' : cause === 'cancer' ? 'years to decades' : s === null ? 'hours later' : cause === 'radiation' || s < 1 ? 'first second' : s < 60 ? `by ${Math.round(s)} s` : `by ${Math.round(s / 60)} min`),
		replay: 'Run again',
		readout: (cause: string, deaths: string, share: string, weapons: string) => `${cause}: ${deaths} dead, ${share} of the total. By warhead, ${weapons}.`,
		hint: 'Point at a pile to break it down by warhead.',
		desc: (deaths: string, injured: string) => `Flow map after Minard: people in reach narrowing through radiation, burns, blast and fallout, with ${deaths} dead piled by cause and ${injured} injured`,
		note: 'Times are when each hazard arrives, not when people die. Death from burns, radiation and fallout can take days or weeks. Injuries are an estimate that the score does not use: injured shares by blast pressure from OTA 1979, a quarter of the remaining survivors inside the burn radius, and everyone left with a fallout dose of 100 rad or more. Nobody is counted twice.'
	},
	summary: {
		head: 'The strike in one page',
		lead: (count: number, yieldText: string, hiroshimas: string, map: string) =>
			`You used ${count === 1 ? 'one warhead' : `${count} warheads`} on ${map}, ${yieldText} in all. That is ${hiroshimas} times the Hiroshima bomb.`,
		leadDead: (deaths: string, share: string) => `The model counts ${deaths} people dead, ${share} of everyone on this map.`,
		leadNone: 'The model counts nobody dead. All of your bursts stayed above the atmosphere, where only the electromagnetic pulse reaches the ground.',
		tiles: {
			injured: 'Injured survivors (estimate)',
			deaths: 'Dead',
			structures: 'Structures destroyed',
			mapPop: 'People on this map',
			yield: 'Total yield',
			fission: 'of it from fission',
			fallout: 'Under fallout of 10+ rad/h',
			blackout: 'Blacked out by EMP',
			weapons: 'Warheads used'
		},
		causesHead: 'What killed them',
		causesBody:
			'A person can only die once, but people in the same place can be exposed to several things that would each kill them. So each death is shared among the causes in proportion to how lethal each was at that spot.',
		causes: {
			blast: 'Blast',
			burns: 'Burns',
			radiation: 'Prompt radiation',
			fallout: 'Fallout'
		},
		causeDefs: {
			blast: 'The shock wave and its winds. Most deaths come from collapsing buildings and flying debris, not from the pressure on the body.',
			burns: 'Heat from the fireball arrives first, at the speed of light. It burns exposed skin kilometres beyond where buildings fall.',
			radiation: 'Neutrons and gamma rays in the first minute. Deadly close in, but for large weapons blast and heat already reach far beyond it.',
			fallout: 'Debris that the fireball pulled up from the ground, coming down radioactive over hours, far downwind. It kills over days and weeks.'
		},
		fatesHead: 'What happened to the people on this map',
		fatesBody: 'Everyone on the map, grouped by how lethal their grid square was. The survivors in the worst squares are often injured, in a place with little left working. The model does not count them.',
		fateBand: (from: string, to: string) => `${from}–${to} killed`,
		fateNone: 'Under 1% killed',
		fateAll: 'Over 90% killed',
		scaleHead: 'For scale: people',
		scaleBody: 'Each row is one event, on a scale where every gridline is ten times the last. A line shows the range historians or the study give.',
		scaleYou: 'Your strike',
		scaleRows: {
			hiroshima: 'Hiroshima, by end of 1945',
			nagasaki: 'Nagasaki, by end of 1945',
			tokyo: 'Tokyo firebombing, March 1945',
			otaCity: 'OTA study: 1 Mt on a large city',
			otaLarge: 'OTA study: large attack, US, 30 days',
			wwii: 'All of the Second World War'
		},
		yieldHead: 'For scale: energy',
		yieldRows: {
			you: 'Your strike',
			hiroshima: 'Hiroshima',
			nagasaki: 'Nagasaki',
			wwii: 'All explosives in WWII (rough)',
			bravo: 'Castle Bravo, 1954',
			tsar: 'Tsar Bomba, 1961',
			tests: 'All atmospheric nuclear tests'
		},
		otaHead: 'A second opinion',
		otaBody: (fatal: string, injured: string, game: string) =>
			`The 1979 US Office of Technology Assessment study used a simple rule for a 1 Mt weapon: above 12 psi 98% die, from 5 to 12 psi 50% die and 40% are hurt, from 2 to 5 psi 5% die and 45% are hurt, and from 1 to 2 psi 25% are hurt. Applied to your plan, that rule gives ${fatal} dead and ${injured} injured from blast alone. The game's own total, which also counts burns, radiation and fallout but has no model of injury, is ${game}. OTA itself calls its bands assumptions, not measurements.`,
		tableHead: 'Weapon by weapon',
		tableBody:
			'"Alone" is what that weapon would have done with no others. "Adds" is what the plan loses if you remove it. When blast rings overlap, a weapon adds less than it would alone, because those people were already dead. It can also add more, because fallout doses stack: two doses that are each survivable can be fatal together.',
		overlap: (n: string) => `Overlap cost you ${n} deaths' worth of effect: that many people would have been counted twice if the weapons had been judged one at a time.`,
		cols: { n: 'No.', weapon: 'Weapon', yield: 'Yield', height: 'Height', share: 'Share of deaths', alone: 'Alone', adds: 'Adds' }
	},

	map: {
		head: 'Where it fell',
		body: 'Each square is one cell of the population grid. Rings show 5 psi (solid) and 1 psi (dashed), and the outlined plumes are the 10 rad/h fallout contours. Hover over any square to read it.',
		modes: { before: 'Before', deaths: 'Deaths', structures: 'Structures', fallout: 'Fallout' },
		keys: {
			before: ['People', ''] as [string, string],
			deaths: ['Survivors', 'Deaths: stronger colour is a larger share killed'] as [string, string],
			structures: ['Standing', 'Destroyed: stronger colour is a larger share'] as [string, string],
			fallout: ['No fallout', 'Fallout: stronger colour is a higher dose rate'] as [string, string]
		},
		whole: 'Whole map',
		strike: 'Fit to strike',
		people: 'People',
		killed: 'Killed',
		structuresGone: 'Structures lost',
		rate: 'Dose rate at H+1',
		desc: 'Map of population cells coloured by the effect of the strike',
		placesHead: 'Places',
		placesBody: (km: string) =>
			`Each cell counts toward its nearest named city, up to ${km} away. These are not city limits, so read the numbers as the area around each place. Landmarks show what was felt at that one point.`,
		cols: { place: 'Place', people: 'People nearby', dead: 'Dead', share: 'Share', psi: 'Peak blast', rate: 'Fallout', near: 'Nearest ground zero' },
		noPlaces: 'No named place on this map was close enough to feel anything.',
		cellsHead: 'What the population data is',
		cells: (cells: string, cellKm: string, kept: string) =>
			`Population comes from the European Commission's GHS-POP 2025 grid and buildings from GHS-BUILT-S. This map keeps its ${cells} most populated cells, each about ${cellKm} wide, holding ${kept} people. Everyone is assumed to be at home, at one moment, spread evenly through their cell. On the widest maps the people in dropped cells are simply missing, so those totals run low.`
	},

	weapon: {
		head: 'Each weapon, one at a time',
		body: 'Pick a weapon. Unless it says otherwise, each page shows that weapon by itself, as if it were the only one you used.',
		tab: (n: number, name: string) => `${n}. ${name}`,
		aimed: (km: string, place: string) => `Ground zero: ${km} from ${place}.`,
		sectionDevice: 'The device',
		noDrawing: 'Never built, so there is nothing to draw.',
		drawnAs: {
			missile: 'Drawn as the whole missile. The warhead sits in the nose and its size is not public.',
			warhead: 'Drawn as the warhead by itself.',
			rv: 'Drawn as the cone-shaped reentry vehicle that carries the warhead.',
			round: 'Drawn as the complete round, as it was fired.'
		},
		outlineNote: 'A schematic outline to scale, from published dimensions. The shape is approximate.',
		renderHint: 'Drag to turn',
		renderDesc: 'Rotatable 3D view of the outside of the weapon',
		renderNote: 'The outside only, drawn from public photographs, so the shape and details are approximate.',
		paint: {
			boy: 'No wartime colour record survives: photos are black and white. The display at the US Air Force museum is olive, shown here. The casing at the Imperial War Museum is dark grey.',
			fat: 'Mustard yellow in written accounts, with black sealing tar over the seams. Wartime photos are black and white.',
			b83: 'Colour follows a gloss-white trainer unit.',
			tsar: 'Follows the casing at the Sarov museum, which is captioned as a related body with a different nose from the real bomb.',
			tsar2: 'Follows the casing at the Sarov museum, which is captioned as a related body with a different nose from the real bomb.',
			ss18: 'Follows a museum display of a late variant.',
			ss25: 'Colour rests on photos of the later Topol-M canister, and is weak evidence.',
			pos: 'Follows a released test round, which may have been painted for those tests. Fins are a guess.',
			w76: 'No source for the colour of this reentry vehicle was found. It is drawn dark as a guess.',
			w87: 'No source for the colour of this reentry vehicle was found. It is drawn dark as a guess.',
			w88: 'No source for the colour of this reentry vehicle was found. It is drawn dark as a guess.'
		} as Record<string, string>,
		facts: { length: 'Length', diameter: 'Diameter', mass: 'Mass', year: 'Year', confidence: 'Source quality', source: 'Source' },
		massConflict: 'sources disagree',
		massApprox: 'upper figure, uncertain',
		confidence: { published: 'Stated by a primary or archive source', secondary: 'Secondary source', uncertain: 'Sources conflict or it is a press report' },
		sectionEnergy: 'How much energy, and where it went',
		yieldLine: (y: string, tnt: string, hiroshimas: string) => `${y} is the energy of ${tnt} of TNT, or ${hiroshimas} Hiroshimas.`,
		tons: (v: string) => `${v} tons`,
		fissionHead: 'Where the energy comes from',
		fission: 'Fission (splitting atoms)',
		fusion: 'Fusion (joining atoms)',
		fissionBody: (share: string) =>
			`${share} of this yield comes from fission, and that matters most for fallout. Fusion releases energy with far less long-lived radioactivity, so a bomb's dose rates scale with its fission share while its blast scales with the total. Public fission figures for most modern weapons are rules of thumb, not measurements.`,
		salted: (x: string) => `This design is also credited with ${x} times the long-lived activity, a game simplification for salting.`,
		dialHead: 'Fission share across the yield dial',
		dialBody: 'Low settings are thought to use the first stage alone, which is all fission. High settings add fusion. The real dial has a few fixed settings, so the points in between are inference.',
		dialX: 'Yield setting',
		dialY: 'Fission share',
		youSet: 'You',
		splitHead: 'Where the energy goes',
		split: { blast: 'Blast and shock', heat: 'Heat', prompt: 'Prompt radiation', residual: 'Lingering radioactivity' },
		splitBody: 'Rule of thumb from Glasstone & Dolan. The share for heat is the value the model uses for this yield and height, which falls near the ground because the ground blocks and absorbs part of it. Lingering radioactivity scales with the fission share.',
		sectionSide: 'Side view, to scale',
		sideBody: 'Drag the time slider or press play, starting from before detonation. After zero, time runs on a stretched scale, because everything important in the first second happens a million times faster than what happens in the first hour. The bars under the ground fill as each effect arrives.',
		side: {
			delivery: {
				gravity: [
					{ id: 'approach', title: 'Approach', body: 'The aircraft holds a straight, level run over the target. The crew aim visually or by radar, and the weapon is still in the bomb bay.' },
					{ id: 'release', title: 'Release', body: 'The bomb falls away, and the aircraft turns hard to get clear of a blast it has only a minute or so to escape.' },
					{ id: 'fall', title: 'Fall', body: 'It falls freely, carrying the aircraft\'s forward speed, so it lands ahead of where it was let go. This is the last stretch in which nothing has happened yet.' }
				],
				retarded: [
					{ id: 'approach', title: 'Approach', body: 'The aircraft runs in toward the target. A large parachute is packed in the weapon\'s tail.' },
					{ id: 'release', title: 'Release', body: 'The weapon drops clear, and the aircraft turns away to escape.' },
					{ id: 'chute', title: 'Parachute', body: 'The parachute opens and slows the fall sharply. That delay gives the aircraft time to get away, or lets the weapon lie on the ground before it fires. The Tsar Bomba took 188 seconds to come down this way.' }
				],
				reentry: [
					{ id: 'reentry', title: 'Reentry', body: 'Launched minutes to half an hour ago from far away, the vehicle has arced through space and is coming back in at more than 6 km per second, about 20 times the speed of sound.' },
					{ id: 'plasma', title: 'Plasma', body: 'The air ahead of it cannot get out of the way, and is compressed until it glows. From the ground it would look like a meteor, for the few seconds left.' }
				],
				cruise: [{ id: 'run', title: 'Run in', body: 'A small jet-powered missile, launched from a distant bomber, flies very low along a preset route. It is about the speed of an airliner, and it makes no bright trail.' }],
				rocket: [{ id: 'descent', title: 'Descent', body: 'A short-range battlefield missile comes down at several times the speed of sound, soon after leaving its launcher.' }],
				shell: [{ id: 'flight', title: 'Flight', body: 'Fired from a recoilless rifle by a small crew, this round flies only 2 to 4 km, close enough that the crew may be within reach of its radiation.' }],
				torpedo: [{ id: 'run', title: 'Run in', body: 'Reported to be an uncrewed nuclear underwater vehicle, it approaches the coast. Its reported speed varies widely between sources, and none has been confirmed.' }],
				emplaced: [{ id: 'cab', title: 'Shot cab', body: 'The device sits in a cab on a small artificial island on the reef at Bikini, joined to the next island by a causeway. Nobody is near it: the firing crew are in a bunker on another island across the atoll.' }],
				unbuilt: [{ id: 'none', title: 'Never delivered', body: 'This was never built, and no way of delivering it was ever designed. The picture starts at the moment of the burst, as the model has it.' }]
			},
			fuze: { id: 'fuze', title: 'Fuze', body: 'A fuze reads the height set before flight. When the weapon gets there, it fires, with no warning at all on the ground.' },
			fuzeSurface: { id: 'fuze', title: 'Impact', body: 'Set to fire on reaching the ground, which digs the fireball into the earth. That is what makes heavy local fallout.' },
			flightLine: (alt: string, speed: string) => `Height ${alt}, moving at ${speed}.`,
			tracking: 'Tracking camera',
			trackingGeneric: 'Tracking camera: generic reentry vehicle',
			enlarged: 'Aircraft and weapon markers are enlarged, since they would be invisible at this scale.',
			raised: 'This burst is higher than this carrier could reach, so the start of its flight has been raised.',
			illustrative: 'No source gives this delivery\'s heights or descent, so they are illustrative.',
			liveNote: 'The cloud\'s billows, dust, fires and skyline are illustrations. Their sizes and timing follow the model, except that the cap is drawn thicker than the model\'s very flat one.',
			stages: [
				{ id: 'flash', title: 'Flash', body: 'The weapon has finished its work within a millionth of a second. What you see first is a ball of air so hot it glows. Heat and light cross the city at the speed of light, before anything else can move.' },
				{ id: 'fireball', title: 'Fireball', body: 'The fireball swells and keeps radiating. Most of the burn injuries happen during this pulse, which is why it matters whether someone is outdoors or can see the fireball. Rising heat starts to lift it.' },
				{ id: 'shock', title: 'Shock', body: 'The shock wave has broken away from the fireball and runs along the ground, starting faster than sound and slowing toward it. Behind the front comes a wind stronger than any hurricane, then a reverse wind back toward the centre.' },
				{ id: 'cloud', title: 'Cloud', body: 'The hot gas rises like a balloon, dragging air up the stem behind it, and spreads out when it stops being lighter than the air around it. It takes about ten minutes to reach its full height. Fires are now starting in the wreckage.' },
				{ id: 'fallout', title: 'Fallout', body: 'If the fireball touched the ground, the cloud carries tonnes of pulverized soil coated in radioactive atoms. The wind moves it downwind while heavy grit falls first. It reaches the ground as dust for hours, far beyond the blast. The veils are an illustration, not a count.' }
			],
			play: 'Play',
			pause: 'Pause',
			time: 'Time',
			scale: 'Height and distance share one scale, and the ground curves as the real Earth does. The camera backs away when it has to, keeping that scale. The rising cloud is worked out as hot air mixing and cooling as it climbs through a standard atmosphere, with dust settling by grain size. It is checked against published cloud heights, with no wind shear. Burst range and shock arrival come from the model.',
			height: 'Height',
			downwind: 'Downwind',
			upwind: 'Upwind',
			front: (km: string, psi: string, wind: string) => `The shock is now ${km} from ground zero at ${psi}, with winds of ${wind}.`,
			pastFront: 'The shock has faded below what the model tracks.',
			humidity: (share: string) => `This weather is taken as ${share} humidity at the ground, an estimate.`,
			localAir: (date: string, share: string, temp: string) => `The air here is the real weather at this spot on ${date}: ${share} humidity and ${temp} °C at the ground, from ERA5 reanalysis.`,
			moistureLift: (lift: string) => `Condensing water adds ${lift} to the cloud's height.`,
			moistureNone: 'Condensing water adds almost nothing to the height here.',
			weatherHead: 'Weather at this ground zero',
			rising: (speed: string) => `It is still rising at ${speed}.`,
			breached: 'At this size the hot air is bigger than the atmosphere can hold, so it bursts out of the top. The rising-air model no longer applies, and the picture only holds it at about 90 km.',
			insideFire: 'The shock is still inside the fireball, where air is too hot for the pressure formula to mean anything.',
			cloudTop: (km: string) => `The cloud top is at ${km}.`,
			refs: { everest: 'Mount Everest', jet: 'Airliner cruise', stratopause: 'Top of stratosphere' },
			rows: { psi20: '20 psi', psi5: '5 psi', psi1: '1 psi', burns: 'Burns', radiation: 'Radiation' },
			magnified: (x: string) => `Inset ×${x}`,
			desc: 'To-scale side view of the burst showing the fireball, shock wave and cloud at the chosen moment'
		},
		sectionWalk: 'Walking out from ground zero',
		walkBody: 'Each row is a ring of ground. Damage descriptions come from the 1979 OTA study. Wind and arrival time come from the shock equations. People and deaths are from your map, for this weapon alone.',
		walkCols: { ring: 'Pressure at outer edge', reach: 'Reaches', arrives: 'Arrives', wind: 'Peak wind', what: 'What it does', people: 'People', dead: 'Dead', buildings: 'Structures lost' },
		walkWhat: {
			20: 'Reinforced concrete buildings levelled.',
			10: 'Most factories and commercial buildings collapse. Small wood and brick homes destroyed.',
			5: 'Light commercial buildings and typical homes destroyed. Heavier construction severely damaged.',
			3: 'Walls of steel-frame buildings blown away. Severe damage to homes. Winds strong enough to kill people in the open.',
			1: 'Damage to structures. People injured by flying glass and debris.'
		} as Record<number, string>,
		beyond: (burn: string, rad: string, cal: string) =>
			`Two more rings are not about pressure. Third-degree burns on exposed skin reach ${burn} (about ${cal} cal/cm²). A dose of 1000 rad, nearly always fatal, reaches ${rad}. Anyone indoors or shaded avoids the burn. The model gives everyone inside the burn ring a 25% chance of dying from it, which is a game choice standing in for how many are exposed.`,
		firstHead: 'Why the numbers look like this',
		psiHead: 'Pressure falls fast with distance',
		psiBody: 'Each gridline up is ten times more pressure. Thin walls fail at a few psi, so what counts is how far out the pressure stays above that, not how high it is at the centre.',
		psiX: 'Distance from ground zero',
		psiY: 'Peak overpressure',
		chanceHead: 'Chance of dying, by distance',
		chanceBody: 'Each line is one cause on its own. Combined is the chance from all of them together, not counting fallout. The burn and radiation steps are sharp because the model uses a radius and ramps it over the last 15%.',
		chanceX: 'Distance from ground zero',
		chanceY: 'Chance of dying',
		chanceAll: 'Combined',
		distHead: 'People and deaths, by distance',
		distBody: 'Grey is who lived at that distance. Colour is who died, including fallout. Where the colour reaches the top of the grey, nobody survived. Bars are rings of equal width, so outer rings hold more ground.',
		distPop: 'People',
		distDead: 'Dead',
		distX: 'Distance from ground zero',
		distY: 'People in each ring',
		heightHead: 'What your height of burst did',
		heightBody: 'A burst above the ground spreads pressure further, because the reflected shock merges with the original and strengthens it near the ground. Too high and the shock is spent before it arrives. The vertical line is your choice. Past the fallout cutoff, the fireball no longer picks up soil.',
		heightX: 'Height of burst',
		heightY: 'Ground range',
		heightYou: 'Your height',
		heightOptimum: 'Best for 5 psi',
		heightCutoff: 'Fallout cutoff',
		heightSurface: 'You burst this on the surface. It gives the shortest blast range but the most fallout, because the fireball digs up the ground and irradiates it.',
		heightLow: (cut: string) => `This burst was low enough for the fireball to touch the ground, so it made some local fallout. Above ${cut} it would have made almost none.`,
		heightAir: (cut: string) => `This burst was above the ${cut} cutoff, so the fireball did not touch the ground and it made little or no local fallout.`,
		yieldHead: 'Why bigger bombs waste energy',
		yieldBody: (extra: string) =>
			`Blast range grows with the cube root of yield, because the shock spreads through a volume. Eight times the yield only doubles the range, and doubling it adds about ${extra}. This is why planners came to prefer many small warheads over one huge one.`,
		yieldX: 'Yield',
		yieldY: 'Ground range, burst at the same relative height',
		yieldYou: 'You',
		yieldLabels: { psi20: '20 psi', psi5: '5 psi', psi1: '1 psi' },
		sectionFallout: 'Fallout',
		falloutBent: 'This plan is straightened out to show the bands clearly. On the map, the plume bends with the winds it meets.',
		noFallout: (cut: string) =>
			`No local fallout. A burst above about ${cut} at this yield doesn't touch the ground, so there's no soil for the radioactive atoms to condense onto. They rise with the cloud and come down much later, thinly, around the world. The model doesn't count that global share.`,
		falloutBody: 'Seen from above, to scale. Each band is the area with at least that dose rate, one hour after the burst. The rate on the ground falls quickly, but it is the dose accumulated over time that kills.',
		gz: 'Ground zero',
		blastRing: '5 psi ring',
		wind: 'Wind',
		falloutDesc: 'Plan view of the fallout contours',
		falloutCols: { rate: 'Dose rate at H+1', length: 'Downwind reach', width: 'Widest', area: 'Area', people: 'People inside', dose: 'Dose, sheltered, at mid-plume' },
		falloutWhy: (fission: string, coupling: string, cap: string, stem: string, top: string, rain: string) =>
			`How it got this shape: ${fission} of the yield was fission, and ${coupling} of the possible activity coupled to the ground at this height. The cloud topped out at ${top}, where the winds are faster than at the surface, so the top drifts at about ${cap} and the stem at about ${stem}. ${rain}`,
		rainNone: 'There was no rain or snow to wash it out early.',
		rainSome: (share: string) => `Precipitation washed out ${share} of the cloud, which makes a shorter, hotter pattern close to ground zero.`,
		falloutDeaths: (dead: string) => `Alone, this weapon's fallout would kill ${dead}.`,
		decayHead: 'How fast fallout decays',
		decayBody: 'The "7:10 rule" from Glasstone & Dolan: for every sevenfold increase in time, the dose rate falls tenfold. After 7 hours it is at a tenth, after 2 days a hundredth, after 2 weeks a thousandth. This is why sheltering for the first days saves so many lives. The curve starts from the 100 rad/h contour.',
		decayX: 'Hours after burst',
		decayY: 'Dose rate',
		doseHead: 'What a dose does to a person',
		doseCols: { dose: 'Dose', what: 'What happens' },
		doseRows: [
			['Under 100 rem', 'Almost no symptoms, though cancer risk rises later.'],
			['100–200', 'Nausea and lower resistance to disease. Hospital generally not needed.'],
			['200–450', 'Severe illness. Most recover with care.'],
			['300', 'About 10% die. Hair loss after about two weeks.'],
			['450', 'About 50% die.'],
			['Over 600', 'Serious illness. The great majority die within weeks.'],
			['Over 1000', 'Only palliative care is possible.']
		],
		doseNote: 'The model assumes shelter passes a fifth of the outdoor dose, which is an estimate. A frame house passes 30–60%, and a basement 5–10%.',
		sectionContribution: 'What this weapon added',
		contribution: { share: 'Its share of deaths', alone: 'Would kill alone', adds: 'Plan loses without it', perKt: 'Deaths per kiloton', structures: 'Structures alone' },
		causesOf: 'What killed its share',
		sectionExo: 'Above the atmosphere',
		exoBody: 'At this height no fallout reaches the ground. Gamma rays strike the upper atmosphere and knock electrons loose. Earth\'s magnetic field makes those electrons radiate a pulse over everything in line of sight, which induces surges in long conductors and unprotected electronics.',
		exoStarfish: 'In the 1962 Starfish Prime test, 1.4 Mt at about 400 km over the Pacific, 30 strings of street lights failed on Oahu, about 1,300 km away. Modern electronics are thought to be more vulnerable, but nobody has tested that at full scale. The game\'s footprint is the line-of-sight horizon times a yield factor that is an estimate.',
		exoCoupling: (f: string) => `The weapon's energy leaves it as X-rays, fast neutrons and hot debris, and there's no air close by to stop them. They stop lower down, where the air thickens, and heat it until it glows. X-rays and debris matter most for high-fission weapons, and this one takes ${f} of its yield from fission. High-fusion weapons send more out as neutrons, which get deeper. Either way the energy ends up as hot air radiating down, so the model treats both alike: a single layer at 80 km sends 20% of the yield toward the ground. That layer and its share are estimates.`,
		exoBurns: (km: string) => `This yield is big enough for that glow to matter: third-degree burns reach ${km} from ground zero, and the deaths are counted.`,
		exoNoBurns: (cal: string, need: string) => `Directly below, the heat comes to about ${cal} cal/cm², and burns start near ${need}. Nobody is burned. It would take a much larger yield or a lower burst.`,
		exoLimit: 'The heated air also drives a shock down toward the ground, estimated here as a share of the yield released at the height of that layer. It only reaches 1 psi at gigaton yields. No published ground figure was available to check this heat or shock against, so read these numbers as rough, and nothing here comes from a simulation.',
		exoScene: {
			stages: [
				{ id: 'xray', title: 'X-rays', body: 'The weapon gives most of its energy off as X-rays, at the speed of light. In a few millionths of a second there is nothing to see yet from outside, only that first light heading out.' },
				{ id: 'pulse', title: 'Pulse', body: 'Gamma rays strike the air and knock electrons loose, and the magnetic field makes them radiate. The pulse crosses everything in line of sight in about a thousandth of a second. City lights are drawn going out behind it, though a real grid would fail unevenly.' },
				{ id: 'layer', title: 'Hot layer', body: 'X-rays and fast neutrons stop in the thin air far below, heating a wide lens that glows. Directly under it, this is where any heat on the ground and the shock from the heated air come from.' },
				{ id: 'debris', title: 'Debris', body: 'The bomb debris rushes out at about 1,000 km per second, until the thin air and the magnetic field stop it. Without air to hold it, this fireball is nothing like one near the ground.' },
				{ id: 'aurora', title: 'Aurora', body: 'Charged debris runs along the magnetic field and lights the upper air, red from oxygen high up and green lower down. After Starfish Prime, an aurora was seen over 1,000 km away, and artificial radiation belts lasted for years.' }
			],
			play: 'Play',
			pause: 'Pause',
			time: 'Time',
			burst: 'Burst',
			layer: 'Hot layer, about 80 km',
			footprint: 'Pulse footprint',
			note: 'One scale throughout. Burst height, the layer, the footprint and any burns come from the model. The debris, the aurora and the timing of the glow are illustration.',
			desc: 'The burst seen from space, with the heated layer below it, the pulse crossing the ground and aurora forming over time'
		},
		exoChart: {
			heights: 'Where the energy stops (height, km)',
			heat: 'Heat on the ground by distance (cal/cm²)',
			range: 'Distance from ground zero',
			neutrons: 'Fast neutrons, about 30 km',
			hard: '10 keV X-rays, about 60 km',
			soft: '1 keV X-rays, about 100 km',
			layer: 'Model layer, 80 km',
			burst: 'Burst',
			burn: 'Third-degree burns',
			readout: (km: string, cal: string) => `${km}: ${cal} cal/cm²`,
			desc: 'Heights where X-rays and neutrons stop in the air, and the heat reaching the ground by distance'
		},
		exoPeople: (p: string) => `This footprint covered ${p} people on your map. The model counts them as blacked out, and the pulse kills nobody. A long grid failure would still kill people, which the model doesn't count.`,
		exoLabels: { burst: 'Burst', horizon: 'Horizon', footprint: 'Pulse footprint', desc: 'Earth with the burst height, line of sight and pulse footprint' },
		person: 'Person, 1.75 m',
		profileDesc: 'To-scale outline of the weapon next to a person',
		facts_: {
			mk54: 'The smallest US nuclear weapon, fired from a jeep-mounted recoilless rifle over 2 to 4 km. A live round was fired in the 1962 Little Feller I shot, watched by Robert Kennedy.',
			w70: 'The neutron-warhead version of the warhead for the Lance battlefield missile. Designed to kill tank crews with radiation while causing less blast damage nearby.',
			boy: 'The Hiroshima bomb, dropped from the B-29 Enola Gay on 6 August 1945. Its gun-type design had never been fully tested before it was used.',
			fat: 'The Nagasaki bomb, dropped from the B-29 Bockscar on 9 August 1945. The primary target was Kokura, and weather sent it to Nagasaki instead.',
			b61: 'A gravity bomb carried by many aircraft, with about 3,150 built across all versions. Its dial sets the yield before flight.',
			w80: 'A warhead for air-launched cruise missiles. In 2007 six missiles armed with it were flown by mistake from Minot to Barksdale, unnoticed for hours.',
			w76: "The commonest warhead on US Trident submarines. Its size is cited to a single Russian source, and the warhead's own dimensions are unpublished.",
			w87: 'A warhead designed for the Peacekeeper missile, now on Minuteman III. Over 1,000 were planned, and 525 were built after Peacekeeper was cut to 50 missiles.',
			w88: 'The most powerful warhead on Trident II. The 1989 FBI raid on the Rocky Flats plant ended production at about 400 of a planned 4,000 to 5,000.',
			ss25: 'A road-mobile Soviet ICBM, carried on a heavy truck so it can hide. The last regiment left combat duty in December 2023.',
			b83: 'The most powerful US weapon since 2011, when the last B53 was dismantled. Designed to be dropped at low level, slowed by parachute.',
			df5: "China's first full-range ICBM. It flew in 1971, and its first deployment in 1981 was just two missiles.",
			b53: 'A massive Cold War gravity bomb carried by the B-47, B-52 and B-58. The last one was dismantled in October 2011.',
			bravo: 'The first US dry-fuel thermonuclear test, on 1 March 1954. It yielded 2.5 times what its designers predicted. Fallout reached the crew of the fishing boat Lucky Dragon, about 130 km away. 23 men received about 300 R and one died.',
			ss18: 'The heaviest ICBM ever deployed, called SATAN by NATO. Its first test ended in failure.',
			pos: 'A nuclear underwater drone, revealed in 2015 by a document shown on Russian TV. Sources conflict on its size and yield, so treat these figures as press reports.',
			cob: 'In a 1950 radio programme, Leo Szilard described a bomb jacketed in cobalt as a warning, not a proposal to build one. No firm evidence shows one was ever built.',
			ripple: 'In 1962 Harold Brown asked for the largest possible yield in about 6,000 lb for the Titan II, whose W-53 warhead gave about 9 Mt. The Ripple II device tested as Housatonic gave 9.96 Mt at 7,139 lb and was estimated to be 99.9% clean, and a fully fuelled version was predicted at 30 to 40 Mt. No such warhead was built. This one is a what-if: 35 Mt at Housatonic\'s clean share, so it leaves almost no fallout. The drawn shape is only a guess at a reentry vehicle that size. Source: Grams, Journal of Cold War Studies, 2021.',
			tsar: 'The largest explosion ever, dropped over Novaya Zemlya on 30 October 1961. It was run at half its design yield by swapping out the uranium tamper. Making its parachute reportedly disrupted Soviet hosiery production.',
			tsar2: 'Tsar Bomba as designed, with a uranium tamper. Its designers left that out of the test, partly because the fallout on Soviet territory would have been enormous. Never built in this form.',
			sodium: 'A what-if. Sodium-24 has a 15 hour half-life, so a bomb salted with it would give a fierce dose in the first days, then fade within weeks. Salted bombs are discussed in open literature and none is known to have been used. How much activity it adds is a game choice.',
			gold: 'A what-if. Gold-198 has a half-life of 2.7 days, so the land stays deadly for weeks, not the years cobalt would mean. Salted bombs are discussed in open literature and none is known to have been used. How much activity it adds is a game choice.',
			gnomon: 'A 1 Gt design that Edward Teller presented to an Atomic Energy Commission advisory meeting in 1954. It was meant to be the first stage of Sundial. Never built or tested. Nothing could have lifted it, so the delivery shown is imagined: a vehicle pushed by nuclear explosions, after Project Orion, the US study of 1958 to 1965.',
			sundial: 'A 10 Gt design Teller presented in 1954, far beyond any way of delivering it. Never built or tested. At this size, the model is far past anything its formulas were fitted to, so treat the numbers as a rough sketch.'
		} as Record<string, string>
	},

	score: {
		head: 'How your score was worked out',
		objective: 'Objective',
		passed: 'Mission accomplished',
		failed: 'Mission failed: at least one check below did not pass, so the rating is 0.',
		checks: 'Every check must pass',
		formulaHigh: (value: string, par: string, rating: string) => `Rating = 100 × your score ÷ command estimate = 100 × ${value} ÷ ${par} = ${rating}`,
		formulaLow: (value: string, par: string, slack: string, rating: string) =>
			`Lower is better here, so the fraction flips. Rating = 100 × (estimate + allowance) ÷ (your score + allowance) = 100 × (${par} + ${slack}) ÷ (${value} + ${slack}) = ${rating}`,
		formulaFail: 'A failed plan scores 0, whatever its numbers.',
		goalTargets: 'every marked target',
		parBody: (goal: string, par: string) =>
			`The goal (${goal}) and the command estimate (${par}) come from a solver that plays each day's puzzle before you do, trying aim points, yields and heights one warhead at a time. It finds a good plan, not the perfect one, which is why you can beat it.`,
		rankHead: 'Rank',
		ranks: ['Relieved', '2nd Lt', 'Captain', 'Major', 'Colonel', 'General', 'Beyond'],
		yours: 'You',
		solverHead: "The solver's plan",
		solverBody: 'What the command estimate came from, for comparison with what you did.',
		solverCols: { weapon: 'Weapon', yield: 'Yield', height: 'Height', dist: 'From map centre' },
		solverNone: 'The solver scored best by holding this warhead back.',
		difficultyHead: 'How the difficulty was measured',
		difficultyBody: (score: string, label: string) =>
			`${score} out of 100, ${label}. The game simulates a plausible player 60 times. They aim at sensible places and avoid what the rings visibly forbid, but they don't optimize. It then tries the solver's plan 30 times with small aim errors. The weights are game choices, and have not been calibrated against real players.`,
		difficultyRows: { plans: 'Plausible plans that failed', progress: 'Progress they did not make', tolerance: "Solver's plan broken by aim error", conditions: 'Extra conditions' },
		difficultyWeight: (w: string) => `weight ${w}`,
		boardNote: 'The other rows on the daily board are simulated from the command estimate. There is no server, so it is not a real leaderboard.'
	},

	how: {
		head: 'How the calculation works',
		body: 'Every square of the map goes through the same steps, once per weapon, about 16,000 squares in all. There is no server: your browser did this.',
		steps: [
			['Date', 'The day number seeds a random generator, which picks the map, objective, weather and arsenal. Everyone gets the same puzzle.'],
			['Weapon', 'Yield and height set the blast, heat and radiation ranges. The fission share and wind set the fallout.'],
			['Each square', 'Distance gives pressure, then chances of dying from blast, burns and radiation. Survival multiplies.'],
			['Fallout', 'Doses from every weapon add together, then the total sets the chance of dying from it.'],
			['Totals', 'People × chance of dying, added over all squares. Then the checks, then your rating.']
		],
		workedHead: 'One real square from your strike',
		workedBody: (lat: string, lon: string, pop: string) =>
			`This is the square that lost the most people while some survived, near ${lat}, ${lon}. ${pop} people lived here.`,
		workedCols: { weapon: 'Weapon', dist: 'Distance', psi: 'Pressure', blast: 'Blast', burns: 'Burns', rad: 'Radiation', survive: 'Survive this weapon' },
		workedChain: {
			direct: 'Surviving all the direct effects (multiply the last column)',
			dose: 'Fallout dose, added across weapons',
			falloutFatal: 'Chance that dose is fatal',
			fatal: 'Chance of dying overall = 1 − direct survival × (1 − fallout)',
			deaths: 'People × that chance',
			standing: 'Share of structures still standing'
		},
		workedNote: 'Values are averaged over four points across the square, so the score changes smoothly as you drag a weapon. That means the three percentages won\'t multiply out exactly to the last column.',
		curvesHead: 'The curves that turn physics into deaths',
		curves: {
			blastTitle: 'Blast: chance of dying',
			structTitle: 'Blast: share of structures lost',
			doseTitle: 'Fallout: chance of dying',
			psi: 'Overpressure',
			dose: 'Dose',
			share: 'Share'
		},
		curvesBody: 'These three tables do more than anything else to decide the totals. They are estimates built from official bands, and no real attack has tested them at this scale.',
		sourcedHead: 'What comes from where',
		sourced: [
			['Blast pressure by range and height', "Brode's 1987 fit to bomb data", 'published'],
			['Shock speed and wind', 'Rankine-Hugoniot equations in Glasstone & Dolan §3.55', 'published'],
			['Heat at a distance', 'Glasstone & Dolan §7, with Brode\'s atmosphere', 'published'],
			['Fallout shape', "Miller's 1969 scaling system", 'published'],
			['Dose from dose rate', 'WSEG-10, as documented by Hanifen', 'published'],
			['Dose lethality', 'OTA 1979 and Glasstone & Dolan', 'published'],
			['Blast fatality and structure curves', 'Estimated, after OTA\'s bands', 'estimate'],
			['Winds above the surface', 'An estimated mid-latitude profile', 'estimate'],
			['Fission share at each dial setting', 'Inferred between known settings', 'estimate'],
			['Shelter passing a fifth of the dose', 'A mix of Glasstone & Dolan\'s cases', 'estimate'],
			['25% die in the burn ring, 30% of buildings burn', 'Chosen for the game', 'choice'],
			['150 m² per structure', 'Chosen for the game', 'choice'],
			['60% goal, difficulty weights, ranks', 'Chosen for the game', 'choice']
		],
		grades: { published: 'Published', estimate: 'Estimate', choice: 'Game choice' }
	},

	missing: {
		head: "What the numbers don't count",
		body: 'The model counts deaths from the direct effects in the first weeks, among people at home. OTA said in 1979 that the largest effects can\'t be calculated at all: fires, medical shortfalls and bottlenecks "would surely take place", leaving survivors in a "race for survival". Here is what is missing.',
		items: [
			['Firestorms', 'Estimated in the march above, but left out of your score, and it depends on assumptions about fuel. Thought to need at least 8 pounds of fuel per square foot. Hamburg had 32 and a US suburb has about 2. Hiroshima\'s began about 20 minutes after the bomb, with inflowing winds peaking at 30–40 mph after 2–3 hours. The game has only a flat 30% of structures burning inside the burn ring.'],
			['Medicine', 'OTA estimated 1 Mt on Detroit would leave about 5,000 hospital beds, about 1% of those injured. The US could treat 1,000–2,000 severe burn cases at the time. Burns over about a quarter of the body are likely fatal without prompt specialized care, so many burn survivors in the game\'s count would die.'],
			['Cancer', 'Estimated in the march above with the linear no-threshold model, but left out of your score. Among Hiroshima and Nagasaki survivors followed from 1958 to 1998, 848 of 7,851 solid cancers (10.7%) are attributed to radiation. Nearly half of leukemia deaths are. OTA expected millions of cancer deaths over 40 years after a large war.'],
			['Global cooling and famine', 'Xia and colleagues (2022) project over 5 billion deaths from hunger after a US-Russia war, and over 2 billion after an India-Pakistan one, from soot blocking sunlight. Others, such as Reisner (2018), find much less cooling from a regional war. The size of this effect is still argued, and it could dwarf everything above.'],
			['Global fallout', 'The game counts only fallout that lands within a day or so. The rest stays up for months and comes down around the world.'],
			['Time of day and warning', 'Everyone is at home and unwarned. A warning, a working day or a shelter would all move these totals, up or down.']
		]
	},

	sources: {
		head: 'Sources',
		body: 'The full method, including every constant and how the model compares with published anchors, is in docs/CALCULATIONS.md and docs/EFFECTS.md in the project repository.',
		list: [
			['Glasstone & Dolan, The Effects of Nuclear Weapons, 3rd ed., 1977', 'https://archive.org/details/effectsofnuclear1977unit'],
			['Office of Technology Assessment, The Effects of Nuclear War, 1979', 'https://ota.fas.org/reports/7906.pdf'],
			['Brode, Airblast from Nuclear Bursts: Analytic Approximations, 1987', ''],
			['Miller, Biological and Radiological Effects of Fallout, 1969', ''],
			['Hanifen, Documentation and Analysis of the WSEG-10 Model, 1980', ''],
			['Sublette, Nuclear Weapons Archive', 'https://nuclearweaponarchive.org/'],
			['Radiation Effects Research Foundation: Hiroshima and Nagasaki deaths, cancer risk', 'https://www.rerf.or.jp/en/faq/'],
			['Federation of American Scientists, Status of World Nuclear Forces', 'https://fas.org/initiative/status-world-nuclear-forces/'],
			['Xia et al., Global food insecurity and famine from nuclear war soot, Nature Food, 2022', 'https://www.colorado.edu/today/2022/08/15/nuclear-war-would-cause-global-famine-and-kill-billions-study-finds'],
			['Reisner et al., Climate impact of a regional nuclear weapons exchange, 2018', 'https://www.osti.gov/pages/biblio/1581574'],
			['European Commission JRC, GHS-POP and GHS-BUILT-S R2023A, CC BY 4.0', 'https://human-settlement.emergency.copernicus.eu/'],
			['Weapon pages also cite Wikipedia for dimensions, and each is marked with its source quality', '']
		],
		scaleNote: 'Rough figures: the 3 Mt total for all Second World War explosives rests on a weak secondary source. Atmospheric testing is about 440 Mt by UNSCEAR via secondary pages, with other tallies from 428 to 545 Mt. War deaths range from 60 to 85 million.'
	}
};

export type DebriefText = typeof EN;
