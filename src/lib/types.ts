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

/** Result of checking a domain's availability */
export interface DomainResult extends DomainCandidate {
	/** DNS records found (empty = no records) */
	records: string[];
	/** Availability status */
	status: 'available' | 'taken' | 'reserved' | 'error' | 'checking';
	/** How the status was determined */
	method?: 'dig' | 'whois';
	/** Error message if status is 'error' */
	error?: string;
	/** Timestamp of check */
	checkedAt?: number;
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
	| 'domainHack';

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
};

/** Available TLDs to check */
export const TLDS = [
	'.com', '.io', '.co', '.dev', '.app', '.party',
	'.site', '.xyz', '.net', '.org', '.ai', '.sh',
	'.is', '.it', '.us', '.me', '.to', '.cc',
	'.so', '.ly', '.gg', '.fm', '.tv', '.in',
] as const;

/** Default TLDs selected on first load */
export const DEFAULT_TLDS = new Set(['.com', '.io', '.co', '.dev', '.app', '.party']);

/** Default mutations selected on first load */
export const DEFAULT_MUTATIONS = new Set<MutationType>(['original', 'dropLastVowel', 'addR', 'plural']);

/** Filter state for results */
export interface Filters {
	status: 'all' | 'available' | 'taken' | 'reserved';
	tlds: Set<string>;
	mutations: Set<MutationType>;
	lengthMin: number;
	lengthMax: number;
	search: string;
}

/** Sort options */
export type SortField = 'domain' | 'name' | 'tld' | 'mutation' | 'status' | 'length';
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
	status: 'available' | 'taken' | 'reserved' | 'error';
	addedAt: number;
	notes?: string;
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
