/** A single domain candidate generated from term + mutation + TLD */
export interface DomainCandidate {
	/** Full domain name e.g. "torchr.dev" */
	domain: string;
	/** Base search term e.g. "torch" */
	term: string;
	/** Mutated name without TLD e.g. "torchr" */
	name: string;
	/** TLD e.g. ".dev" */
	tld: string;
	/** Mutation type that produced this name */
	mutation: MutationType;
	/** Character count of name (without TLD dot) */
	nameLength: number;
}

/** Shared domain status — used across results, saved domains, and monitoring */
export type DomainStatus = 'available' | 'likely-available' | 'taken' | 'reserved' | 'error' | 'checking';

/** How the domain status was determined */
export type DomainMethod = 'dig' | 'whois' | 'doh' | 'rdap' | 'worker';

/** Active resolver mode */
export type ResolverMode = 'local-api' | 'edge-worker' | 'browser-doh';

/** Result of checking a domain's availability */
export interface DomainResult extends DomainCandidate {
	/** DNS records found (empty = no records) */
	records: string[];
	/** Availability status */
	status: DomainStatus;
	/** How the status was determined */
	method?: DomainMethod;
	/** Error message if status is 'error' */
	error?: string;
	/** Timestamp of check */
	checkedAt?: number;
	/** Previous status before recheck (only set when status changed) */
	previousStatus?: DomainStatus;
}

/** Supported mutation types */
export type MutationType =
	| 'original'
	| 'dropLastVowel'
	| 'dropAllVowels'
	| 'addR'
	| 'addLy'
	| 'addIfy'
	| 'addDb'
	| 'addHq'
	| 'plural'
	| 'doubleLastLetter'
	| 'domainHack'
	| 'compound'
	| 'custom';

/** Display metadata for each mutation type */
export const MUTATION_INFO: Record<MutationType, { label: string; description: string; example: string }> = {
	original:         { label: 'Original',       description: 'Unchanged term',           example: 'torch' },
	dropLastVowel:    { label: 'Drop vowel',     description: 'Remove last vowel',        example: 'torchr → filtr' },
	dropAllVowels:    { label: 'No vowels',      description: 'Remove all vowels',        example: 'trch → fltr' },
	addR:             { label: 'Add -r',          description: 'Append r suffix',          example: 'scopr → seekr' },
	addLy:            { label: 'Add -ly',         description: 'Append ly suffix',         example: 'torchly → siftly' },
	addIfy:           { label: 'Add -ify',        description: 'Append ify suffix',        example: 'torchify' },
	addDb:            { label: 'Add -db',         description: 'Append db suffix',         example: 'torchdb' },
	addHq:            { label: 'Add -hq',         description: 'Append hq suffix',         example: 'torchhq' },
	plural:           { label: 'Plural',          description: 'Add s/es ending',          example: 'specs → torches' },
	doubleLastLetter: { label: 'Double last',     description: 'Double final consonant',   example: 'digg → specc' },
	domainHack:       { label: 'Domain hack',     description: 'TLD forms word ending',    example: 'del.icio.us' },
	compound:         { label: 'Compound',        description: 'Combine term pairs',       example: 'torchlight' },
	custom:           { label: 'Custom',          description: 'User-defined patterns',    example: '{term}hub' },
};

/** Registrar identifiers */
export type RegistrarId = 'namecheap' | 'porkbun' | 'cloudflare' | 'spaceship';

/** Registrar display info */
export const REGISTRARS: Record<RegistrarId, { name: string; color: string; url: (d: string) => string }> = {
	namecheap:  { name: 'Namecheap',  color: '#fe5803', url: (d) => `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(d)}` },
	porkbun:    { name: 'Porkbun',    color: '#ef6f9a', url: (d) => `https://porkbun.com/checkout/search?q=${encodeURIComponent(d)}` },
	cloudflare: { name: 'Cloudflare', color: '#f6821f', url: (d) => `https://dash.cloudflare.com/?to=/:account/registrar/register/${encodeURIComponent(d)}` },
	spaceship:  { name: 'Spaceship',  color: '#635bff', url: (d) => `https://www.spaceship.com/domain-search/?query=${encodeURIComponent(d)}` },
};

export const REGISTRAR_IDS = Object.keys(REGISTRARS) as RegistrarId[];

/**
 * All available TLDs — union of Spaceship, Namecheap, Porkbun, Cloudflare offerings.
 * Sorted alphabetically. Users select which to search via the UI.
 */
export const TLDS = [
	'.abogado', '.ac', '.academy', '.accountant', '.accountants', '.actor', '.ad', '.adult',
	'.agency', '.ai', '.airforce', '.apartments', '.app', '.archi', '.army', '.art', '.asia',
	'.associates', '.attorney', '.auction', '.audio', '.auto', '.autos',
	'.baby', '.band', '.bar', '.barcelona', '.bargains', '.beauty', '.beer', '.best', '.bet',
	'.bid', '.bike', '.bingo', '.bio', '.biz', '.black', '.blackfriday', '.blog', '.blue',
	'.boats', '.bond', '.boo', '.boston', '.bot', '.boutique', '.broker', '.build', '.builders',
	'.business', '.buzz', '.bz',
	'.ca', '.cab', '.cafe', '.cam', '.camera', '.camp', '.capital', '.car', '.cards', '.care',
	'.careers', '.cars', '.casa', '.cash', '.casino', '.cat', '.catering', '.cc', '.center',
	'.ceo', '.cfd', '.channel', '.charity', '.chat', '.cheap', '.christmas', '.church', '.city',
	'.claims', '.cleaning', '.click', '.clinic', '.clothing', '.cloud', '.club', '.cm', '.cn',
	'.co', '.coach', '.codes', '.coffee', '.college', '.com', '.community', '.company',
	'.compare', '.computer', '.condos', '.construction', '.consulting', '.contact', '.contractors',
	'.cooking', '.cool', '.country', '.coupons', '.courses', '.credit', '.creditcard', '.cricket',
	'.cruises', '.cv', '.cx', '.cymru', '.cyou',
	'.dad', '.dance', '.date', '.dating', '.day', '.de', '.deal', '.dealer', '.deals', '.degree',
	'.delivery', '.democrat', '.dental', '.dentist', '.desi', '.design', '.dev', '.diamonds',
	'.diet', '.digital', '.direct', '.directory', '.discount', '.diy', '.doctor', '.dog',
	'.domains', '.download',
	'.earth', '.eco', '.education', '.email', '.energy', '.engineer', '.engineering',
	'.enterprises', '.equipment', '.es', '.esq', '.estate', '.eu', '.events', '.exchange',
	'.expert', '.exposed', '.express',
	'.fail', '.faith', '.family', '.fan', '.fans', '.farm', '.fashion', '.fast', '.feedback',
	'.film', '.finance', '.financial', '.fish', '.fishing', '.fit', '.fitness', '.flights',
	'.florist', '.flowers', '.fm', '.foo', '.food', '.football', '.forex', '.forsale', '.forum',
	'.foundation', '.fr', '.free', '.fun', '.fund', '.furniture', '.futbol', '.fyi',
	'.gallery', '.game', '.games', '.garden', '.gay', '.gdn', '.gg', '.gift', '.gifts', '.gives',
	'.giving', '.glass', '.global', '.gmbh', '.gold', '.golf', '.graphics', '.gratis', '.green',
	'.gripe', '.group', '.guide', '.guitars', '.guru',
	'.hair', '.hamburg', '.haus', '.health', '.healthcare', '.help', '.hiphop', '.hiv', '.hockey',
	'.holdings', '.holiday', '.homes', '.horse', '.hospital', '.host', '.hosting', '.hot',
	'.house', '.how',
	'.icu', '.id', '.im', '.immo', '.immobilien', '.in', '.inc', '.industries', '.info', '.ing',
	'.ink', '.institute', '.insure', '.international', '.investments', '.io', '.irish', '.is',
	'.it',
	'.je', '.jetzt', '.jewelry', '.juegos',
	'.kaufen', '.kids', '.kim', '.kitchen', '.kiwi', '.krd', '.kyoto',
	'.la', '.land', '.lat', '.law', '.lawyer', '.lease', '.legal', '.lgbt', '.li', '.life',
	'.lifestyle', '.lighting', '.limited', '.limo', '.link', '.live', '.living', '.llc', '.loan',
	'.loans', '.locker', '.lol', '.london', '.lotto', '.love', '.ltd', '.ltda', '.luxe',
	'.luxury', '.ly',
	'.maison', '.makeup', '.management', '.market', '.marketing', '.markets', '.mba', '.me',
	'.media', '.melbourne', '.meme', '.memorial', '.men', '.menu', '.miami', '.mobi', '.mobile',
	'.moda', '.moe', '.mom', '.money', '.monster', '.mortgage', '.motorcycles', '.mov', '.movie',
	'.music', '.mx', '.my',
	'.nagoya', '.name', '.navy', '.net', '.network', '.new', '.news', '.nexus', '.ngo', '.ninja',
	'.nl', '.now', '.nu', '.nyc',
	'.observer', '.okinawa', '.one', '.ong', '.onl', '.online', '.org', '.osaka',
	'.page', '.paris', '.partners', '.parts', '.party', '.pe', '.pet', '.ph', '.phd', '.photo',
	'.photography', '.photos', '.pics', '.pictures', '.pink', '.pizza', '.place', '.plumbing',
	'.plus', '.poker', '.porn', '.press', '.pro', '.productions', '.prof', '.promo', '.properties',
	'.property', '.protection', '.pub', '.pw',
	'.quest',
	'.racing', '.realty', '.recipes', '.red', '.rehab', '.reise', '.reisen', '.rent', '.rentals',
	'.repair', '.report', '.republican', '.rest', '.restaurant', '.review', '.reviews', '.rip',
	'.rocks', '.rodeo', '.rsvp', '.run', '.ryukyu',
	'.sale', '.salon', '.sarl', '.sbs', '.school', '.schule', '.science', '.security', '.select',
	'.services', '.sex', '.sexy', '.sg', '.sh', '.shiksha', '.shoes', '.shop', '.shopping',
	'.show', '.singles', '.site', '.ski', '.skin', '.so', '.soccer', '.social', '.software',
	'.solar', '.solutions', '.soy', '.space', '.spot', '.storage', '.store', '.stream', '.studio',
	'.study', '.style', '.sucks', '.supplies', '.supply', '.support', '.surf', '.surgery',
	'.sydney', '.systems',
	'.talk', '.tattoo', '.tax', '.taxi', '.team', '.tech', '.technology', '.tel', '.tennis',
	'.theater', '.theatre', '.tickets', '.tienda', '.tips', '.tires', '.to', '.today', '.tokyo',
	'.tools', '.top', '.tours', '.town', '.toys', '.trade', '.trading', '.training', '.travel',
	'.tube', '.tv',
	'.uk', '.university', '.uno', '.us',
	'.vacations', '.vana', '.vc', '.vegas', '.ventures', '.vet', '.viajes', '.video', '.villas',
	'.vin', '.vip', '.vision', '.vodka', '.vote', '.voting', '.voto', '.voyage',
	'.wales', '.watch', '.webcam', '.website', '.wedding', '.wiki', '.win', '.wine', '.work',
	'.works', '.world', '.ws', '.wtf',
	'.xxx', '.xyz',
	'.yachts', '.yoga', '.yokohama', '.you',
	'.zip', '.zone',
] as const;

/** Popular TLDs shown by default in the selector (before expanding) */
export const POPULAR_TLDS: readonly string[] = [
	'.com', '.io', '.co', '.dev', '.app', '.ai', '.sh', '.me', '.us',
	'.net', '.org', '.xyz', '.site', '.party', '.tv', '.fm', '.gg',
	'.cc', '.to', '.in', '.is', '.it', '.ly', '.so', '.tech', '.cloud',
	'.design', '.blog', '.pro', '.info', '.fun', '.lol', '.art', '.top',
];

/** Default TLDs selected on first load */
export const DEFAULT_TLDS = new Set(['.com', '.io', '.co', '.dev', '.app', '.party']);

/** Default mutations selected on first load */
export const DEFAULT_MUTATIONS = new Set<MutationType>(['original', 'dropLastVowel', 'addR', 'plural']);

/** Filter state for results */
export interface Filters {
	status: 'all' | 'available' | 'likely-available' | 'taken' | 'reserved';
	tlds: Set<string>;
	mutations: Set<MutationType>;
	lengthMin: number;
	lengthMax: number;
	priceRenewalMin: number;
	priceRenewalMax: number;
	search: string;
	hideErrors: boolean;
	/** Only show domains whose TLD is sold by ALL selected registrars */
	registrars: Set<RegistrarId>;
}

/** Sort options */
export type SortField = 'domain' | 'name' | 'tld' | 'mutation' | 'status' | 'length' | 'price' | 'renewal';
export type SortDir = 'asc' | 'desc';

/** TLD pricing from Porkbun */
export interface TldPricing {
	registration: string;
	renewal: string;
}

/** Saved domain list */
export interface DomainList {
	id: string;
	name: string;
	color: string;
	createdAt: number;
}

/** A domain saved to a list */
export interface SavedDomain {
	domain: string;
	listId: string;
	status: Exclude<DomainStatus, 'checking'>;
	addedAt: number;
	notes?: string;
}

/** TLD preset for quick selection */
export interface TldPreset {
	label: string;
	description: string;
	tlds: readonly string[];
}

/** Quick-select TLD preset groups */
export const TLD_PRESETS: TldPreset[] = [
	{
		label: 'Cheap',
		description: 'Budget-friendly TLDs under ~$5/yr',
		tlds: ['.com', '.net', '.org', '.info', '.xyz', '.site', '.online', '.top', '.club', '.fun', '.icu', '.space', '.click', '.link', '.store'],
	},
	{
		label: 'Dev',
		description: 'Developer-friendly TLDs',
		tlds: ['.dev', '.app', '.io', '.sh', '.co', '.ai', '.tech', '.codes', '.run', '.build', '.software', '.tools', '.cloud', '.systems', '.engineering'],
	},
	{
		label: 'ccTLDs',
		description: 'Country-code TLDs popular for branding',
		tlds: ['.co', '.io', '.me', '.us', '.cc', '.to', '.in', '.is', '.it', '.ly', '.so', '.sh', '.fm', '.tv', '.gg', '.im', '.ai'],
	},
];

/** Search history entry — persisted to localStorage */
export interface SearchHistoryEntry {
	id: string;
	terms: string;
	tlds: string[];
	mutations: MutationType[];
	timestamp: number;
	resultCount: number;
}

/** User-defined custom mutation pattern (e.g. "{term}hub", "go{term}") */
export interface CustomMutation {
	id: string;
	label: string;
	/** Pattern with {term} placeholder, e.g. "{term}hub" */
	pattern: string;
}

/** Whois/RDAP detail data */
export interface WhoisData {
	domain: string;
	/** Raw text (whois) or JSON string (RDAP) */
	raw: string;
	parsed: {
		registrar?: string;
		created?: string;
		expires?: string;
		updated?: string;
		nameservers?: string[];
		status?: string[];
	};
	fetchedAt: number;
	/** Data source */
	source?: 'whois' | 'rdap';
}

/** Domain monitoring entry — tracks status changes over time */
export interface MonitorEntry {
	domain: string;
	status: DomainResult['status'];
	lastChecked: number;
	history: { status: DomainStatus; checkedAt: number }[];
}

/** Domain monitoring configuration */
export interface MonitorConfig {
	enabled: boolean;
	/** Interval in minutes: 60, 360, or 1440 */
	intervalMinutes: number;
}

/** Preset colors for domain lists */
export const LIST_COLORS = [
	'#06b6d4', // cyan
	'#22c55e', // green
	'#eab308', // yellow
	'#ef4444', // red
	'#a855f7', // purple
	'#ec4899', // pink
	'#f97316', // orange
	'#3b82f6', // blue
	'#14b8a6', // teal
	'#6366f1', // indigo
] as const;
