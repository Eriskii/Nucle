export type TheatreKind = 'city' | 'region' | 'world';

export interface Landmark {
	name: string;
	lat: number;
	lon: number;
}

export interface Theatre {
	id: string;
	name: string;
	kind: TheatreKind;
	lat: number;
	lon: number;
	/** Scope radius in km; the azimuthal projection is centred on lat/lon. */
	radiusKm: number;
	/** Number of 30-arcsecond raster cells merged into one data point. */
	cellFactor: number;
	landmarks?: Landmark[];
}

const lm = (name: string, lat: number, lon: number): Landmark => ({ name, lat, lon });

const city = (id: string, name: string, lat: number, lon: number, landmarks: Landmark[]): Theatre => ({
	id,
	name,
	kind: 'city',
	lat,
	lon,
	radiusKm: 70,
	cellFactor: 1,
	landmarks
});

const region = (
	id: string,
	name: string,
	lat: number,
	lon: number,
	radiusKm: number,
	cellFactor: number
): Theatre => ({ id, name, kind: 'region', lat, lon, radiusKm, cellFactor });

export const THEATRES: Theatre[] = [
	city('nyc', 'NEW YORK', 40.72, -73.98, [
		lm('EMPIRE STATE BLDG', 40.7484, -73.9857),
		lm('STATUE OF LIBERTY', 40.6892, -74.0445),
		lm('JFK AIRPORT', 40.6413, -73.7781),
		lm('NEWARK AIRPORT', 40.6895, -74.1745),
		lm('GEORGE WASHINGTON BR', 40.8517, -73.9527),
		lm('YANKEE STADIUM', 40.8296, -73.9262),
		lm('BELLEVUE HOSPITAL', 40.7392, -73.9754),
		lm('INDIAN POINT PLANT', 41.2697, -73.9525)
	]),
	city('lon', 'LONDON', 51.51, -0.12, [
		lm('WESTMINSTER PALACE', 51.4995, -0.1248),
		lm('TOWER OF LONDON', 51.5081, -0.0759),
		lm('ST PAUL\'S CATHEDRAL', 51.5138, -0.0984),
		lm('HEATHROW AIRPORT', 51.47, -0.4543),
		lm('GREENWICH OBSERVATORY', 51.4769, -0.0005),
		lm('WEMBLEY STADIUM', 51.556, -0.2795),
		lm('GATWICK AIRPORT', 51.1537, -0.1821),
		lm('WINDSOR CASTLE', 51.4839, -0.6044)
	]),
	city('tyo', 'TOKYO', 35.68, 139.76, [
		lm('IMPERIAL PALACE', 35.6852, 139.7528),
		lm('TOKYO TOWER', 35.6586, 139.7454),
		lm('HANEDA AIRPORT', 35.5494, 139.7798),
		lm('SHINJUKU STATION', 35.6896, 139.7006),
		lm('YOKOHAMA PORT', 35.4537, 139.6423),
		lm('YOKOTA AIR BASE', 35.7485, 139.3485),
		lm('NARITA AIRPORT', 35.772, 140.3929),
		lm('KAMAKURA BUDDHA', 35.3167, 139.5359)
	]),
	city('mow', 'MOSCOW', 55.75, 37.62, [
		lm('KREMLIN', 55.752, 37.6175),
		lm('MOSCOW STATE UNIV', 55.7033, 37.5302),
		lm('OSTANKINO TOWER', 55.8197, 37.6117),
		lm('SHEREMETYEVO AIRPORT', 55.9726, 37.4146),
		lm('DOMODEDOVO AIRPORT', 55.4088, 37.9063),
		lm('LUZHNIKI STADIUM', 55.7158, 37.5537),
		lm('STAR CITY', 55.8789, 38.1097),
		lm('VNUKOVO AIRPORT', 55.5915, 37.2615)
	]),
	city('lax', 'LOS ANGELES', 34.05, -118.25, [
		lm('LA CITY HALL', 34.0537, -118.2428),
		lm('GRIFFITH OBSERVATORY', 34.1184, -118.3004),
		lm('LAX AIRPORT', 33.9416, -118.4085),
		lm('PORT OF LONG BEACH', 33.7542, -118.2165),
		lm('ROSE BOWL', 34.1613, -118.1676),
		lm('JPL PASADENA', 34.2013, -118.1714),
		lm('DISNEYLAND', 33.8121, -117.919),
		lm('HOLLYWOOD SIGN', 34.1341, -118.3215)
	]),
	city('par', 'PARIS', 48.86, 2.35, [
		lm('EIFFEL TOWER', 48.8584, 2.2945),
		lm('NOTRE DAME', 48.853, 2.3499),
		lm('LOUVRE', 48.8606, 2.3376),
		lm('VERSAILLES', 48.8049, 2.1204),
		lm('ORLY AIRPORT', 48.7262, 2.3652),
		lm('CHARLES DE GAULLE AP', 49.0097, 2.5479),
		lm('STADE DE FRANCE', 48.9245, 2.3601),
		lm('LA DEFENSE', 48.8918, 2.2361)
	]),
	city('bjs', 'BEIJING', 39.9, 116.4, [
		lm('FORBIDDEN CITY', 39.9163, 116.3972),
		lm('TEMPLE OF HEAVEN', 39.8822, 116.4066),
		lm('SUMMER PALACE', 39.9999, 116.2755),
		lm('CAPITAL AIRPORT', 40.0799, 116.6031),
		lm('NATIONAL STADIUM', 39.9929, 116.3966),
		lm('DAXING AIRPORT', 39.5098, 116.4105),
		lm('BADALING GREAT WALL', 40.3598, 116.0199),
		lm('TSINGHUA UNIV', 40.0, 116.3264)
	]),
	city('del', 'DELHI', 28.61, 77.21, [
		lm('RED FORT', 28.6562, 77.241),
		lm('INDIA GATE', 28.6129, 77.2295),
		lm('QUTB MINAR', 28.5244, 77.1855),
		lm('INDIRA GANDHI AIRPORT', 28.5562, 77.1),
		lm('LOTUS TEMPLE', 28.5535, 77.2588),
		lm('AIIMS HOSPITAL', 28.5672, 77.21),
		lm('JAMA MASJID', 28.6507, 77.2334),
		lm('NOIDA STADIUM', 28.6062, 77.3613)
	]),
	city('cai', 'CAIRO', 30.04, 31.24, [
		lm('GIZA PYRAMIDS', 29.9792, 31.1342),
		lm('CAIRO CITADEL', 30.0287, 31.2599),
		lm('CAIRO TOWER', 30.0459, 31.2243),
		lm('EGYPTIAN MUSEUM', 30.0478, 31.2336),
		lm('CAIRO AIRPORT', 30.1219, 31.4056),
		lm('SAQQARA NECROPOLIS', 29.8713, 31.2165),
		lm('AIN SHAMS UNIV', 30.0766, 31.285),
		lm('HELIOPOLIS PALACE', 30.0917, 31.3123)
	]),
	city('sao', 'SAO PAULO', -23.55, -46.63, [
		lm('SE CATHEDRAL', -23.5513, -46.6341),
		lm('IBIRAPUERA PARK', -23.5874, -46.6576),
		lm('MASP MUSEUM', -23.5614, -46.6559),
		lm('GUARULHOS AIRPORT', -23.4356, -46.4731),
		lm('CONGONHAS AIRPORT', -23.6261, -46.6564),
		lm('PORT OF SANTOS', -23.9769, -46.3126),
		lm('MORUMBI STADIUM', -23.6, -46.72),
		lm('USP CAMPUS', -23.5595, -46.7312)
	]),
	city('syd', 'SYDNEY', -33.87, 151.21, [
		lm('OPERA HOUSE', -33.8568, 151.2153),
		lm('HARBOUR BRIDGE', -33.8523, 151.2108),
		lm('SYDNEY AIRPORT', -33.9399, 151.1753),
		lm('LUCAS HEIGHTS REACTOR', -34.0509, 150.9792),
		lm('CRICKET GROUND', -33.8915, 151.2249),
		lm('BONDI BEACH', -33.8915, 151.2767),
		lm('PARRAMATTA', -33.8151, 151.0011),
		lm('PORT BOTANY', -33.9694, 151.2211)
	]),
	city('chi', 'CHICAGO', 41.88, -87.63, [
		lm('SEARS TOWER', 41.8789, -87.6359),
		lm('O\'HARE AIRPORT', 41.9742, -87.9073),
		lm('MIDWAY AIRPORT', 41.7868, -87.7522),
		lm('WRIGLEY FIELD', 41.9484, -87.6553),
		lm('NAVY PIER', 41.8917, -87.6086),
		lm('ARGONNE NATL LAB', 41.7128, -87.9829),
		lm('FERMILAB', 41.8319, -88.2571),
		lm('UNIV OF CHICAGO', 41.7886, -87.5987)
	]),
	city('ist', 'ISTANBUL', 41.01, 28.98, [
		lm('HAGIA SOPHIA', 41.0086, 28.9802),
		lm('TOPKAPI PALACE', 41.0115, 28.9834),
		lm('BOSPHORUS BRIDGE', 41.0451, 29.0342),
		lm('GALATA TOWER', 41.0256, 28.9741),
		lm('ISTANBUL AIRPORT', 41.2753, 28.7519),
		lm('SABIHA GOKCEN AP', 40.8986, 29.3092),
		lm('BLUE MOSQUE', 41.0054, 28.9768),
		lm('MAIDEN\'S TOWER', 41.0211, 29.0041)
	]),
	city('was', 'WASHINGTON', 38.9, -77.04, [
		lm('US CAPITOL', 38.8899, -77.0091),
		lm('WHITE HOUSE', 38.8977, -77.0365),
		lm('PENTAGON', 38.8719, -77.0563),
		lm('WASHINGTON MONUMENT', 38.8895, -77.0353),
		lm('DULLES AIRPORT', 38.9531, -77.4565),
		lm('ANDREWS AFB', 38.8108, -76.867),
		lm('FORT MEADE', 39.1086, -76.7433),
		lm('WALTER REED', 39.0023, -77.0937)
	]),
	city('mex', 'MEXICO CITY', 19.43, -99.13, [
		lm('ZOCALO', 19.4326, -99.1332),
		lm('CHAPULTEPEC CASTLE', 19.4204, -99.1819),
		lm('TEOTIHUACAN', 19.6925, -98.8438),
		lm('BENITO JUAREZ AP', 19.4361, -99.0719),
		lm('ESTADIO AZTECA', 19.3029, -99.1505),
		lm('UNAM CAMPUS', 19.3322, -99.1869),
		lm('BASILICA GUADALUPE', 19.4847, -99.1176),
		lm('XOCHIMILCO', 19.2572, -99.1039)
	]),
	region('uk', 'BRITISH ISLES', 54.3, -3.5, 620, 5),
	region('jpn', 'JAPAN', 36.5, 137.5, 1000, 6),
	region('ceu', 'CENTRAL EUROPE', 50.0, 11.0, 850, 6),
	region('kor', 'KOREA', 37.8, 127.5, 480, 4),
	region('usa', 'UNITED STATES', 38.5, -97.0, 2750, 12),
	region('rus', 'WESTERN RUSSIA', 55.5, 42.0, 1500, 10),
	region('ind', 'INDIA', 22.0, 79.0, 1700, 10),
	region('chn', 'EASTERN CHINA', 32.0, 114.0, 1500, 8),
	region('mde', 'MIDDLE EAST', 31.0, 44.0, 1500, 8),
	region('bra', 'SOUTHEAST BRAZIL', -21.0, -46.0, 1100, 8),
	{
		id: 'wld',
		name: 'NORTHERN HEMISPHERE',
		kind: 'world',
		lat: 90,
		// Puts North America at the bottom of the scope and Russia at the top.
		lon: -100,
		radiusKm: 13500,
		cellFactor: 16
	}
];

export const theatreById = (id: string): Theatre => {
	const t = THEATRES.find((x) => x.id === id);
	if (!t) throw new Error(`unknown theatre ${id}`);
	return t;
};
