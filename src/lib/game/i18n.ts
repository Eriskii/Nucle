// Russian for the PVO theme, with the units a Soviet crew would read:
// overpressure in kg/cm², wind in m/s, dose rate in roentgen per hour.

export type Lang = 'en' | 'ru';

export const PSI_TO_KGCM2 = 0.0703;

const comma = (s: string) => s.replace('.', ',');

export function fmtPressure(psi: number, lang: Lang): string {
	if (lang === 'en') return `${+psi.toFixed(1)} PSI`;
	return `${comma((psi * PSI_TO_KGCM2).toFixed(2))} КГ/СМ²`;
}

export const fmtWind = (kmh: number, lang: Lang) =>
	lang === 'en' ? `${kmh} KM/H` : `${Math.round(kmh / 3.6)} М/С`;

export const fmtRate = (rate: number, lang: Lang) =>
	lang === 'en' ? `${Math.round(rate)} RAD/H` : `${Math.round(rate)} Р/Ч`;

/** A yield as number and unit, split so nixie tubes can show the number alone. */
export function yieldParts(kt: number, lang: Lang): [string, string] {
	const ru = lang === 'ru';
	const n = (v: number) => (ru ? comma(`${+v.toPrecision(3)}`) : `${+v.toPrecision(3)}`);
	if (kt >= 1000) return [n(kt / 1000), ru ? 'МТ' : 'MT'];
	if (kt < 1) return [n(kt * 1000), 'T'];
	return [n(kt), ru ? 'КТ' : 'KT'];
}

export function heightParts(m: number, lang: Lang): [string, string] {
	const ru = lang === 'ru';
	if (m === 0) return ['0', ru ? 'ЗЕМЛЯ' : 'SURFACE'];
	if (m >= 10000) return [(m / 1000).toFixed(0), ru ? 'КМ' : 'KM'];
	return [`${m}`, ru ? 'М' : 'M'];
}

export const UI = {
	en: {
		title: 'NUCLE',
		console: 'WEAPONS DIRECTOR 1-3 · AN/FSQ-7',
		exercise: 'EXERCISE №',
		archive: 'ARCHIVE',
		streak: 'STREAK',
		played: 'PLAYED',
		best: 'BEST',
		orders: 'ORDERS',
		rings: 'RINGS',
		fallout: 'FALLOUT',
		population: 'POPULATION',
		dataSelect: 'INPUT DATA SELECTION',
		order: 'OPERATIONAL ORDER',
		conditions: 'CONDITIONS',
		weather: 'WEATHER',
		realWeather: 'AT MAP CENTRE. REAL RECORDS FOR THE DATE. IT VARIES ACROSS THE MAP: SHOW FALLOUT TO SEE WIND AND HUMIDITY.',
		windToward: 'SURFACE WIND TOWARD',
		at: 'AT',
		wargame: 'WARGAME',
		of: 'OF',
		pass: 'PASS',
		fail: 'FAIL',
		report: 'STRIKE REPORT',
		success: 'MISSION ACCOMPLISHED',
		failure: 'MISSION FAILED',
		rating: 'RATING',
		fatalities: 'FATALITIES',
		structures: 'STRUCTURES',
		difficulty: 'EXERCISE DIFFICULTY',
		planPass: 'PLAUSIBLE PLANS THAT SUCCEEDED',
		planProgress: 'THEIR TYPICAL PROGRESS',
		tolerance: 'ESTIMATE SURVIVES AIM ERROR',
		condCount: 'CONDITIONS IMPOSED',
		board: 'DAILY BOARD, SIMULATED WINGS',
		failed: 'FAILED',
		copy: 'COPY RESULT',
		copied: 'COPIED TO CLIPBOARD',
		next: 'NEXT EXERCISE AT 0000 LOCAL',
		rack: 'WARHEAD SELECT',
		theoretical: 'THEORETICAL',
		disarm: 'DISARM',
		aim: 'AIM LIGHT GUN AT THE DISPLAY TO ASSIGN GROUND ZERO',
		yieldLabel: 'YIELD',
		height: 'HEIGHT',
		surface: 'SURFACE',
		optimum: 'OPTIMUM',
		exo100: 'EXO 100 KM',
		exo400: 'EXO 400 KM',
		psi20: '20 PSI',
		psi5: '5 PSI',
		psi1: '1 PSI',
		burns: 'BURNS',
		kmUnit: 'KM',
		digital: 'DIGITAL DISPLAY',
		runWargame: 'RUN WARGAME',
		execute: 'EXECUTE',
		lift: 'LIFT COVER',
		close: 'CLOSE',
		computing: 'COMPUTING DAILY EXERCISE',
		standby: 'LIGHT GUN STANDBY',
		tgt: 'TGT',
		clean: 'CLEAN',
		noFire: 'NO FIRE',
		translate: 'TRANSLATE',
		sound: 'ROOM AUDIO',
		theme: 'CONSOLE',
		acknowledge: 'ACKNOWLEDGE',
		zoneTerm: 'PSI'
	},
	ru: {
		title: 'НУКЛЕ',
		console: 'ПУЛЬТ НАВЕДЕНИЯ · АСУ ПВО',
		exercise: 'УЧЕНИЕ №',
		archive: 'АРХИВ',
		streak: 'СЕРИЯ',
		played: 'ВСЕГО',
		best: 'РЕКОРД',
		orders: 'ИНСТРУКЦИЯ',
		rings: 'ЗОНЫ',
		fallout: 'РАД. СЛЕД',
		population: 'НАСЕЛЕНИЕ',
		dataSelect: 'ВЫБОР ДАННЫХ',
		order: 'БОЕВОЙ ПРИКАЗ',
		conditions: 'УСЛОВИЯ',
		weather: 'МЕТЕОУСЛОВИЯ',
		realWeather: 'В ЦЕНТРЕ КАРТЫ. НАСТОЯЩИЕ ДАННЫЕ ЗА ЭТУ ДАТУ. ПОГОДА МЕНЯЕТСЯ ПО КАРТЕ: ВКЛЮЧИТЕ СЛЕД, ЧТОБЫ ВИДЕТЬ ВЕТЕР И ВЛАЖНОСТЬ.',
		windToward: 'ПРИЗЕМНЫЙ ВЕТЕР В НАПРАВЛЕНИИ',
		at: ',',
		wargame: 'РАСЧЁТ',
		of: 'ИЗ',
		pass: 'ДА ',
		fail: 'НЕТ',
		report: 'ДОНЕСЕНИЕ ОБ УДАРЕ',
		success: 'ЗАДАЧА ВЫПОЛНЕНА',
		failure: 'ЗАДАЧА НЕ ВЫПОЛНЕНА',
		rating: 'ОЦЕНКА',
		fatalities: 'ПОТЕРИ',
		structures: 'ЗДАНИЯ',
		difficulty: 'СЛОЖНОСТЬ УЧЕНИЯ',
		planPass: 'УСПЕШНЫХ ТИПОВЫХ ПЛАНОВ',
		planProgress: 'ИХ ОБЫЧНЫЙ РЕЗУЛЬТАТ',
		tolerance: 'УСТОЙЧИВОСТЬ К ОШИБКЕ НАВЕДЕНИЯ',
		condCount: 'ЧИСЛО УСЛОВИЙ',
		board: 'СВОДКА ЗА СУТКИ, МОДЕЛЬ',
		failed: 'СРЫВ',
		copy: 'КОПИРОВАТЬ ИТОГ',
		copied: 'СКОПИРОВАНО',
		next: 'СЛЕДУЮЩЕЕ УЧЕНИЕ В 00:00',
		rack: 'ТАБЛО БОЕЗАРЯДОВ',
		theoretical: 'ПРОЕКТ',
		disarm: 'СНЯТЬ',
		aim: 'УКАЖИТЕ ТОЧКУ ПРИЦЕЛИВАНИЯ НА ИНДИКАТОРЕ',
		yieldLabel: 'МОЩНОСТЬ',
		height: 'ВЫСОТА',
		surface: 'НАЗЕМНЫЙ',
		optimum: 'ОПТИМУМ',
		exo100: 'ЗАТМ. 100 КМ',
		exo400: 'ЗАТМ. 400 КМ',
		psi20: '1,41 КГ/СМ²',
		psi5: '0,35 КГ/СМ²',
		psi1: '0,07 КГ/СМ²',
		burns: 'ОЖОГИ',
		kmUnit: 'КМ',
		digital: 'ЦИФРОВОЕ ТАБЛО',
		runWargame: 'ПРОБНЫЙ РАСЧЁТ',
		execute: 'ПУСК',
		lift: 'ОТКРЫТЬ КРЫШКУ',
		close: 'ЗАКРЫТЬ',
		computing: 'РАСЧЁТ СУТОЧНОГО УЧЕНИЯ',
		standby: 'ИНДИКАТОР КРУГОВОГО ОБЗОРА',
		tgt: 'ЦЕЛЬ',
		clean: 'ЧИСТО',
		noFire: 'ЗАПРЕТ',
		translate: 'ПЕРЕВОД',
		sound: 'ЗВУК',
		theme: 'ПУЛЬТ',
		acknowledge: 'ПРИНЯТО',
		zoneTerm: 'КГ/СМ²'
	}
} as const;

export const PRECIP_RU: Record<string, string> = {
	CLEAR: 'ЯСНО',
	HAZE: 'ДЫМКА',
	OVERCAST: 'ОБЛАЧНО',
	RAIN: 'ДОЖДЬ',
	SNOW: 'СНЕГ'
};

export const THEATRE_RU: Record<string, string> = {
	nyc: 'НЬЮ-ЙОРК',
	lon: 'ЛОНДОН',
	tyo: 'ТОКИО',
	mow: 'МОСКВА',
	lax: 'ЛОС-АНДЖЕЛЕС',
	par: 'ПАРИЖ',
	bjs: 'ПЕКИН',
	del: 'ДЕЛИ',
	cai: 'КАИР',
	sao: 'САН-ПАУЛУ',
	syd: 'СИДНЕЙ',
	chi: 'ЧИКАГО',
	ist: 'СТАМБУЛ',
	was: 'ВАШИНГТОН',
	mex: 'МЕХИКО',
	uk: 'БРИТАНСКИЕ ОСТРОВА',
	jpn: 'ЯПОНИЯ',
	ceu: 'ЦЕНТРАЛЬНАЯ ЕВРОПА',
	kor: 'КОРЕЯ',
	usa: 'СОЕДИНЁННЫЕ ШТАТЫ',
	rus: 'ЗАПАДНАЯ РОССИЯ',
	ind: 'ИНДИЯ',
	chn: 'ВОСТОЧНЫЙ КИТАЙ',
	mde: 'БЛИЖНИЙ ВОСТОК',
	bra: 'ЮГО-ВОСТОЧНАЯ БРАЗИЛИЯ',
	wld: 'СЕВЕРНОЕ ПОЛУШАРИЕ'
};

const LANDMARK_RU: Record<string, string> = {
	'EMPIRE STATE BLDG': 'ЭМПАЙР-СТЕЙТ-БИЛДИНГ',
	'STATUE OF LIBERTY': 'СТАТУЯ СВОБОДЫ',
	'JFK AIRPORT': 'АЭРОПОРТ КЕННЕДИ',
	'NEWARK AIRPORT': 'АЭРОПОРТ НЬЮАРК',
	'GEORGE WASHINGTON BR': 'МОСТ ВАШИНГТОНА',
	'YANKEE STADIUM': 'СТАДИОН ЯНКИ',
	'BELLEVUE HOSPITAL': 'БОЛЬНИЦА БЕЛЛЬВЮ',
	'INDIAN POINT PLANT': 'АЭС ИНДИАН-ПОЙНТ',
	'WESTMINSTER PALACE': 'ВЕСТМИНСТЕРСКИЙ ДВОРЕЦ',
	'TOWER OF LONDON': 'ТАУЭР',
	"ST PAUL'S CATHEDRAL": 'СОБОР СВ. ПАВЛА',
	'HEATHROW AIRPORT': 'АЭРОПОРТ ХИТРОУ',
	'GREENWICH OBSERVATORY': 'ГРИНВИЧСКАЯ ОБСЕРВАТОРИЯ',
	'WEMBLEY STADIUM': 'СТАДИОН УЭМБЛИ',
	'GATWICK AIRPORT': 'АЭРОПОРТ ГАТВИК',
	'WINDSOR CASTLE': 'ВИНДЗОРСКИЙ ЗАМОК',
	'IMPERIAL PALACE': 'ИМПЕРАТОРСКИЙ ДВОРЕЦ',
	'TOKYO TOWER': 'ТОКИЙСКАЯ БАШНЯ',
	'HANEDA AIRPORT': 'АЭРОПОРТ ХАНЭДА',
	'SHINJUKU STATION': 'СТАНЦИЯ СИНДЗЮКУ',
	'YOKOHAMA PORT': 'ПОРТ ЙОКОГАМА',
	'YOKOTA AIR BASE': 'АВИАБАЗА ЙОКОТА',
	'NARITA AIRPORT': 'АЭРОПОРТ НАРИТА',
	'KAMAKURA BUDDHA': 'БУДДА В КАМАКУРЕ',
	KREMLIN: 'КРЕМЛЬ',
	'MOSCOW STATE UNIV': 'МГУ',
	'OSTANKINO TOWER': 'ОСТАНКИНСКАЯ БАШНЯ',
	'SHEREMETYEVO AIRPORT': 'АЭРОПОРТ ШЕРЕМЕТЬЕВО',
	'DOMODEDOVO AIRPORT': 'АЭРОПОРТ ДОМОДЕДОВО',
	'LUZHNIKI STADIUM': 'СТАДИОН ЛУЖНИКИ',
	'STAR CITY': 'ЗВЁЗДНЫЙ ГОРОДОК',
	'VNUKOVO AIRPORT': 'АЭРОПОРТ ВНУКОВО',
	'LA CITY HALL': 'МЭРИЯ ЛОС-АНДЖЕЛЕСА',
	'GRIFFITH OBSERVATORY': 'ОБСЕРВАТОРИЯ ГРИФФИТ',
	'LAX AIRPORT': 'АЭРОПОРТ ЛОС-АНДЖЕЛЕС',
	'PORT OF LONG BEACH': 'ПОРТ ЛОНГ-БИЧ',
	'ROSE BOWL': 'СТАДИОН РОУЗ-БОУЛ',
	'JPL PASADENA': 'ЛРД, ПАСАДЕНА',
	DISNEYLAND: 'ДИСНЕЙЛЕНД',
	'HOLLYWOOD SIGN': 'НАДПИСЬ ГОЛЛИВУД',
	'EIFFEL TOWER': 'ЭЙФЕЛЕВА БАШНЯ',
	'NOTRE DAME': 'НОТР-ДАМ',
	LOUVRE: 'ЛУВР',
	VERSAILLES: 'ВЕРСАЛЬ',
	'ORLY AIRPORT': 'АЭРОПОРТ ОРЛИ',
	'CHARLES DE GAULLE AP': 'АЭРОПОРТ ШАРЛЬ-ДЕ-ГОЛЛЬ',
	'STADE DE FRANCE': 'СТАД-ДЕ-ФРАНС',
	'LA DEFENSE': 'ДЕФАНС',
	'FORBIDDEN CITY': 'ЗАПРЕТНЫЙ ГОРОД',
	'TEMPLE OF HEAVEN': 'ХРАМ НЕБА',
	'SUMMER PALACE': 'ЛЕТНИЙ ДВОРЕЦ',
	'CAPITAL AIRPORT': 'СТОЛИЧНЫЙ АЭРОПОРТ',
	'NATIONAL STADIUM': 'НАЦИОНАЛЬНЫЙ СТАДИОН',
	'DAXING AIRPORT': 'АЭРОПОРТ ДАСИН',
	'BADALING GREAT WALL': 'ВЕЛИКАЯ СТЕНА, БАДАЛИН',
	'TSINGHUA UNIV': 'УНИВЕРСИТЕТ ЦИНХУА',
	'RED FORT': 'КРАСНЫЙ ФОРТ',
	'INDIA GATE': 'ВОРОТА ИНДИИ',
	'QUTB MINAR': 'КУТБ-МИНАР',
	'INDIRA GANDHI AIRPORT': 'АЭРОПОРТ ИНДИРЫ ГАНДИ',
	'LOTUS TEMPLE': 'ХРАМ ЛОТОСА',
	'AIIMS HOSPITAL': 'БОЛЬНИЦА AIIMS',
	'JAMA MASJID': 'ДЖАМА-МАСДЖИД',
	'NOIDA STADIUM': 'СТАДИОН НОЙДА',
	'GIZA PYRAMIDS': 'ПИРАМИДЫ ГИЗЫ',
	'CAIRO CITADEL': 'КАИРСКАЯ ЦИТАДЕЛЬ',
	'CAIRO TOWER': 'КАИРСКАЯ БАШНЯ',
	'EGYPTIAN MUSEUM': 'ЕГИПЕТСКИЙ МУЗЕЙ',
	'CAIRO AIRPORT': 'АЭРОПОРТ КАИР',
	'SAQQARA NECROPOLIS': 'НЕКРОПОЛЬ СААКАРА',
	'AIN SHAMS UNIV': 'УНИВЕРСИТЕТ АЙН-ШАМС',
	'HELIOPOLIS PALACE': 'ДВОРЕЦ ГЕЛИОПОЛИС',
	'SE CATHEDRAL': 'СОБОР СЕ',
	'IBIRAPUERA PARK': 'ПАРК ИБИРАПУЭРА',
	'MASP MUSEUM': 'МУЗЕЙ МАСП',
	'GUARULHOS AIRPORT': 'АЭРОПОРТ ГУАРУЛЬЮС',
	'CONGONHAS AIRPORT': 'АЭРОПОРТ КОНГОНЬЯС',
	'PORT OF SANTOS': 'ПОРТ САНТУС',
	'MORUMBI STADIUM': 'СТАДИОН МОРУМБИ',
	'USP CAMPUS': 'УНИВЕРСИТЕТ САН-ПАУЛУ',
	'OPERA HOUSE': 'ОПЕРНЫЙ ТЕАТР',
	'HARBOUR BRIDGE': 'МОСТ ХАРБОР-БРИДЖ',
	'SYDNEY AIRPORT': 'АЭРОПОРТ СИДНЕЙ',
	'LUCAS HEIGHTS REACTOR': 'РЕАКТОР ЛУКАС-ХАЙТС',
	'CRICKET GROUND': 'КРИКЕТНЫЙ СТАДИОН',
	'BONDI BEACH': 'ПЛЯЖ БОНДАЙ',
	PARRAMATTA: 'ПАРРАМАТТА',
	'PORT BOTANY': 'ПОРТ БОТАНИ',
	'SEARS TOWER': 'БАШНЯ СИРС',
	"O'HARE AIRPORT": 'АЭРОПОРТ О’ХАРА',
	'MIDWAY AIRPORT': 'АЭРОПОРТ МИДУЭЙ',
	'WRIGLEY FIELD': 'СТАДИОН РИГЛИ-ФИЛД',
	'NAVY PIER': 'ВОЕННО-МОРСКОЙ ПИРС',
	'ARGONNE NATL LAB': 'АРГОННСКАЯ ЛАБОРАТОРИЯ',
	FERMILAB: 'ФЕРМИЛАБ',
	'UNIV OF CHICAGO': 'ЧИКАГСКИЙ УНИВЕРСИТЕТ',
	'HAGIA SOPHIA': 'АЙЯ-СОФИЯ',
	'TOPKAPI PALACE': 'ДВОРЕЦ ТОПКАПЫ',
	'BOSPHORUS BRIDGE': 'БОСФОРСКИЙ МОСТ',
	'GALATA TOWER': 'ГАЛАТСКАЯ БАШНЯ',
	'ISTANBUL AIRPORT': 'АЭРОПОРТ СТАМБУЛ',
	'SABIHA GOKCEN AP': 'АЭРОПОРТ САБИХА ГЁКЧЕН',
	'BLUE MOSQUE': 'ГОЛУБАЯ МЕЧЕТЬ',
	"MAIDEN'S TOWER": 'ДЕВИЧЬЯ БАШНЯ',
	'US CAPITOL': 'КАПИТОЛИЙ',
	'WHITE HOUSE': 'БЕЛЫЙ ДОМ',
	PENTAGON: 'ПЕНТАГОН',
	'WASHINGTON MONUMENT': 'МОНУМЕНТ ВАШИНГТОНА',
	'DULLES AIRPORT': 'АЭРОПОРТ ДАЛЛЕС',
	'ANDREWS AFB': 'АВИАБАЗА ЭНДРЮС',
	'FORT MEADE': 'ФОРТ-МИД',
	'WALTER REED': 'ГОСПИТАЛЬ УОЛТЕРА РИДА',
	ZOCALO: 'СОКАЛО',
	'CHAPULTEPEC CASTLE': 'ЗАМОК ЧАПУЛЬТЕПЕК',
	TEOTIHUACAN: 'ТЕОТИУАКАН',
	'BENITO JUAREZ AP': 'АЭРОПОРТ БЕНИТО ХУАРЕС',
	'ESTADIO AZTECA': 'СТАДИОН АЦТЕКА',
	'UNAM CAMPUS': 'УНИВЕРСИТЕТ UNAM',
	'BASILICA GUADALUPE': 'БАЗИЛИКА ГВАДАЛУПЕ',
	XOCHIMILCO: 'СОЧИМИЛЬКО'
};

const SITE_RU: Record<string, string> = {
	'SILO FIELD': 'ШАХТНЫЙ РАЙОН',
	'COMMAND BUNKER': 'ЗАЩИЩЁННЫЙ КП',
	'RADAR STATION': 'РЛС',
	'AIR BASE': 'АВИАБАЗА',
	DEPOT: 'СКЛАД',
	'SUB PEN': 'УКРЫТИЕ ПЛ',
	'SIGNALS SITE': 'УЗЕЛ СВЯЗИ'
};

/** Cyrillic for a site or place name, keeping Latin where there's no known form. */
export function placeName(p: { name: string; ru?: string }, lang: Lang): string {
	if (lang === 'en') return p.name;
	if (p.ru) return p.ru.toUpperCase();
	const known = LANDMARK_RU[p.name];
	if (known) return known;
	for (const [en, ru] of Object.entries(SITE_RU)) {
		if (p.name.startsWith(`${en} `)) return `${ru}${p.name.slice(en.length)}`;
	}
	return p.name;
}

export const WEAPON_NAME_RU: Record<string, string> = {
	boy: 'МАЛЫШ',
	fat: 'ТОЛСТЯК',
	ss25: 'РТ-2ПМ ТОПОЛЬ',
	df5: 'ДУНФЭН-5',
	ss18: 'Р-36М САТАНА',
	pos: 'СТАТУС-6 ПОСЕЙДОН',
	cob: 'КОБАЛЬТОВЫЙ ЗАРЯД',
	sodium: 'НАТРИЕВЫЙ ЗАРЯД',
	gold: 'ЗОЛОТОЙ ЗАРЯД',
	ripple: 'РИПЛ ТИТАН-2',
	tsar: 'ЦАРЬ-БОМБА',
	tsar2: 'ЦАРЬ-БОМБА ПОЛНАЯ',
	gnomon: 'ГНОМОН',
	sundial: 'СОЛНЕЧНЫЕ ЧАСЫ'
};

export const WEAPON_KEY_RU: Record<string, string> = {
	boy: 'МАЛЫШ',
	fat: 'ТОЛСТ',
	ss25: 'ТОПОЛЬ',
	df5: 'ДФ-5',
	ss18: 'Р-36М',
	pos: 'СТАТУС',
	cob: 'КОБАЛЬТ',
	sodium: 'НАТРИЙ',
	gold: 'ЗОЛОТО',
	ripple: 'РИПЛ',
	tsar: 'ЦАРЬ',
	tsar2: 'ЦАРЬ-2',
	gnomon: 'ГНОМОН',
	sundial: 'ЧАСЫ'
};

export const WEAPON_NOTE_RU: Record<string, string> = {
	mk54: 'БЕЗОТКАТНОЕ ОРУДИЕ',
	w70: 'НЕЙТРОННАЯ БОЕГОЛОВКА',
	boy: 'ХИРОСИМА, 1945',
	fat: 'НАГАСАКИ, 1945',
	b61: 'АВИАБОМБА С РЕГУЛИРУЕМОЙ МОЩНОСТЬЮ',
	w80: 'БЧ КРЫЛАТОЙ РАКЕТЫ',
	w76: 'БЧ РАКЕТЫ ТРАЙДЕНТ',
	w87: 'БЧ МИНИТМЕН-3',
	w88: 'БЧ ТРАЙДЕНТ-2',
	ss25: 'ПОДВИЖНЫЙ ГРУНТОВЫЙ КОМПЛЕКС',
	b83: 'СТРАТЕГИЧЕСКАЯ АВИАБОМБА',
	df5: 'ШАХТНАЯ МБР',
	b53: 'АВИАБОМБА, 1962',
	bravo: 'ИСПЫТАНИЕ КАСЛ БРАВО, 1954',
	ss18: 'ТЯЖЁЛАЯ МБР, МОНОБЛОК',
	pos: 'ПРИБРЕЖНАЯ ТОРПЕДА',
	cob: 'ТЕОРЕТИЧЕСКИЙ, СЦИЛАРД, 1950',
	sodium: 'ТЕОРЕТИЧЕСКИЙ, NA-24, ПЕРИОД 15 Ч',
	gold: 'ТЕОРЕТИЧЕСКИЙ, AU-198, ПЕРИОД 2,7 СУТ',
	ripple: 'ЧИСТАЯ БЧ, НЕ СОЗДАНА, 1962',
	tsar: 'НОВАЯ ЗЕМЛЯ, 1961',
	tsar2: 'ПО ПРОЕКТУ, С ОБОЛОЧКОЙ U-238',
	gnomon: 'ПРОЕКТ ТЕЛЛЕРА, 1954',
	sundial: 'ПРОЕКТ ТЕЛЛЕРА, 1954'
};

export const BOARD_RU: Record<string, string> = {
	'COMMAND ESTIMATE': 'РАСЧЁТ ШТАБА',
	'RAND PROJECT STAFF': 'РЭНД, ГРУППА ПРОЕКТА',
	'CINCSAC WAR ROOM': 'КП САК',
	'NORAD BATTLE STAFF': 'БОЕВОЙ РАСЧЁТ НОРАД',
	'OFFUTT PLANNERS': 'ПЛАНОВИКИ ОФФУТТА',
	'HOLLOMAN TEST WING': 'ИСПЫТАТЕЛИ ХОЛЛОМАНА',
	'WHIZ KIDS, PENTAGON': 'ПЕНТАГОН',
	'HIGH FRONTIER STUDY': 'ГРУППА ВЫСОКОЙ ГРАНИЦЫ',
	'THULE NIGHT SHIFT': 'НОЧНАЯ СМЕНА, ТУЛЕ',
	'GENERAL STAFF, MOSCOW': 'ГЕНШТАБ, МОСКВА',
	'CONELRAD DUTY OFFICER': 'ДЕЖУРНЫЙ КОНЕЛРАД',
	'AWDREY TEST CREW': 'РАСЧЁТ ОДРИ',
	'LOOKING GLASS CREW': 'ЭКИПАЖ ЗАЗЕРКАЛЬЕ',
	YOU: 'ВЫ'
};

export const DIFFICULTY_RU: Record<string, string> = {
	ROUTINE: 'ПЛАНОВАЯ',
	PRIORITY: 'СРОЧНАЯ',
	IMMEDIATE: 'ОЧЕНЬ СРОЧНАЯ',
	FLASH: 'МОЛНИЯ',
	'FLASH OVERRIDE': 'ВНЕ ВСЯКОЙ ОЧЕРЕДИ'
};

export const RANK_RU: Record<string, string> = {
	'RELIEVED OF COMMAND': 'ОТСТРАНЁН ОТ КОМАНДОВАНИЯ',
	'SECOND LIEUTENANT': 'ЛЕЙТЕНАНТ',
	CAPTAIN: 'КАПИТАН',
	MAJOR: 'МАЙОР',
	COLONEL: 'ПОЛКОВНИК',
	GENERAL: 'ГЕНЕРАЛ',
	'BEYOND COMMAND ESTIMATE': 'СВЕРХ РАСЧЁТА ШТАБА'
};
