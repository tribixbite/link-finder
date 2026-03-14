#!/usr/bin/env bun
/**
 * digr API server — runs dig + whois lookups on Termux.
 * Two-phase availability check:
 *   1. Fast: `dig` checks DNS status code (NXDOMAIN vs NOERROR)
 *   2. Verify: `whois` confirms availability for NXDOMAIN domains
 *
 * Usage: bun scripts/api-server.ts
 * Listens on port 3001 (proxied by Vite dev server at /api)
 */

const PORT = 3001;
const MAX_CONCURRENT_DIG = 12;
const MAX_CONCURRENT_WHOIS = 4; // whois servers rate-limit aggressively
const DIG_TIMEOUT_MS = 5000;
const WHOIS_TIMEOUT_MS = 8000;
const WHOIS_MAX_RETRIES = 3;
const WHOIS_RETRY_BASE_DELAY_MS = 1000; // exponential: 1s, 2s, 4s
const WHOIS_MIN_GAP_MS = 500; // per-TLD cooldown between whois calls
const MAX_DOMAINS_PER_REQUEST = 500;
const RESULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minute result cache
const VALID_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/i;
const PRICING_TTL_MS = 60 * 60 * 1000; // 1 hour cache

interface CheckRequest {
	domains: string[];
}

interface DomainCheckResult {
	domain: string;
	records: string[];
	status: 'available' | 'taken' | 'reserved' | 'error';
	error?: string;
	/** How the status was determined */
	method?: 'dig' | 'whois';
}

/** Patterns in whois output indicating the domain is NOT registered */
const WHOIS_AVAILABLE_PATTERNS = [
	/no match/i,
	/not found/i,
	/no data found/i,
	/no entries found/i,
	/status:\s*free/i,
	/is available/i,
	/domain not found/i,
	/no object found/i,
	/nothing found/i,
	/^%% no matching objects/im,
];

/** Patterns indicating the domain is reserved by the registry */
const WHOIS_RESERVED_PATTERNS = [
	/reserved domain/i,
	/status:\s*reserved/i,
	/serverhold/i,
];

/** Patterns indicating the domain is registered */
const WHOIS_REGISTERED_PATTERNS = [
	/registrar:/i,
	/creation date:/i,
	/registry domain id:/i,
	/registered on:/i,
	/created:/i,
];

// --- Request dedup: coalesce concurrent checks for the same domain ---
const _pendingChecks = new Map<string, Promise<DomainCheckResult>>();

// --- Server-side result cache (15min TTL) ---
const _resultCache = new Map<string, { result: DomainCheckResult; cachedAt: number }>();

function getCachedResult(domain: string): DomainCheckResult | null {
	const entry = _resultCache.get(domain);
	if (!entry) return null;
	if (Date.now() - entry.cachedAt > RESULT_CACHE_TTL_MS) {
		_resultCache.delete(domain);
		return null;
	}
	return entry.result;
}

function cacheResult(result: DomainCheckResult): void {
	// Only cache successful results, not errors
	if (result.status === 'error') return;
	_resultCache.set(result.domain, { result, cachedAt: Date.now() });
}

// Periodic cache cleanup every 5 minutes
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of _resultCache) {
		if (now - entry.cachedAt > RESULT_CACHE_TTL_MS) {
			_resultCache.delete(key);
		}
	}
}, 5 * 60 * 1000);

// --- Per-TLD whois cooldown ---
const _whoisLastRequest = new Map<string, number>();

/** Extract TLD from domain (e.g. "torch.dev" → "dev") */
function extractTld(domain: string): string {
	const dot = domain.lastIndexOf('.');
	return dot >= 0 ? domain.slice(dot + 1) : domain;
}

/** Wait if needed to enforce per-TLD whois rate limiting */
async function whoisCooldown(domain: string): Promise<void> {
	const tld = extractTld(domain);
	const last = _whoisLastRequest.get(tld) ?? 0;
	const elapsed = Date.now() - last;
	if (elapsed < WHOIS_MIN_GAP_MS) {
		await new Promise((r) => setTimeout(r, WHOIS_MIN_GAP_MS - elapsed));
	}
	_whoisLastRequest.set(tld, Date.now());
}

/**
 * Phase 1: Fast dig check — returns DNS status code + records.
 * NXDOMAIN = domain doesn't exist in DNS (needs whois confirmation)
 * NOERROR + records = definitely taken
 * NOERROR + no records = registered but no A records = taken
 */
async function digCheck(domain: string): Promise<{ nxdomain: boolean; records: string[] }> {
	try {
		const proc = Bun.spawn(
			['dig', '+noall', '+comments', '+answer', '+time=3', '+tries=1', domain],
			{ stdout: 'pipe', stderr: 'pipe' }
		);

		const timeout = new Promise<null>((resolve) =>
			setTimeout(() => resolve(null), DIG_TIMEOUT_MS)
		);
		const result = await Promise.race([proc.exited, timeout]);

		if (result === null) {
			proc.kill();
			return { nxdomain: false, records: [] };
		}

		const stdout = await new Response(proc.stdout).text();
		const lines = stdout.trim().split('\n').filter(Boolean);

		// Check for NXDOMAIN in the comments/header
		const nxdomain = lines.some((l) => /status:\s*NXDOMAIN/i.test(l));

		// Extract answer records (lines that don't start with ;)
		const records = lines.filter((l) => !l.startsWith(';') && l.includes('\t'));

		return { nxdomain, records: records.length > 0 ? records.map((r) => r.split('\t').pop()?.trim() || r) : [] };
	} catch {
		return { nxdomain: false, records: [] };
	}
}

/**
 * Single whois attempt — runs `whois` once and parses the output.
 */
async function whoisCheckOnce(domain: string): Promise<'available' | 'taken' | 'reserved' | 'error'> {
	try {
		const proc = Bun.spawn(['whois', domain], {
			stdout: 'pipe',
			stderr: 'pipe',
		});

		const timeout = new Promise<null>((resolve) =>
			setTimeout(() => resolve(null), WHOIS_TIMEOUT_MS)
		);
		const result = await Promise.race([proc.exited, timeout]);

		if (result === null) {
			proc.kill();
			return 'error';
		}

		const stdout = await new Response(proc.stdout).text();

		// Check reserved first (more specific)
		for (const pattern of WHOIS_RESERVED_PATTERNS) {
			if (pattern.test(stdout)) return 'reserved';
		}

		// Check if registered
		for (const pattern of WHOIS_REGISTERED_PATTERNS) {
			if (pattern.test(stdout)) return 'taken';
		}

		// Check if available
		for (const pattern of WHOIS_AVAILABLE_PATTERNS) {
			if (pattern.test(stdout)) return 'available';
		}

		// If whois returned something but we can't parse it, assume taken
		// (better to show false-taken than false-available)
		return stdout.trim().length > 50 ? 'taken' : 'error';
	} catch {
		return 'error';
	}
}

/**
 * Phase 2: Whois verification with retry — retries up to WHOIS_MAX_RETRIES
 * times with WHOIS_RETRY_DELAY_MS between attempts to handle transient
 * timeouts from rate-limiting whois servers.
 */
async function whoisCheck(domain: string): Promise<'available' | 'taken' | 'reserved' | 'error'> {
	for (let attempt = 1; attempt <= WHOIS_MAX_RETRIES; attempt++) {
		await whoisCooldown(domain);
		const result = await whoisCheckOnce(domain);
		if (result !== 'error') return result;
		// Exponential backoff: 1s, 2s, 4s — don't delay after the last attempt
		if (attempt < WHOIS_MAX_RETRIES) {
			const delay = WHOIS_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	return 'error';
}

/** Full domain check: dig + whois verification for NXDOMAIN results */
async function checkDomain(domain: string): Promise<DomainCheckResult> {
	// Check result cache first
	const cached = getCachedResult(domain);
	if (cached) return cached;

	// Dedup: return existing in-flight promise for same domain
	const pending = _pendingChecks.get(domain);
	if (pending) return pending;

	const promise = (async (): Promise<DomainCheckResult> => {
		try {
			const dig = await digCheck(domain);

			// If dig found records, domain is definitely taken
			if (dig.records.length > 0) {
				const r: DomainCheckResult = { domain, records: dig.records, status: 'taken', method: 'dig' };
				cacheResult(r);
				return r;
			}

			// If NOT NXDOMAIN (NOERROR with no records), domain is registered but has no A records
			if (!dig.nxdomain) {
				const r: DomainCheckResult = { domain, records: [], status: 'taken', method: 'dig' };
				cacheResult(r);
				return r;
			}

			// NXDOMAIN — domain doesn't exist in DNS, verify with whois
			const whois = await whoisCheck(domain);
			if (whois === 'reserved') {
				const r: DomainCheckResult = { domain, records: [], status: 'reserved', method: 'whois' };
				cacheResult(r);
				return r;
			}
			if (whois === 'taken') {
				const r: DomainCheckResult = { domain, records: [], status: 'taken', method: 'whois' };
				cacheResult(r);
				return r;
			}
			if (whois === 'available') {
				const r: DomainCheckResult = { domain, records: [], status: 'available', method: 'whois' };
				cacheResult(r);
				return r;
			}

			// Whois errored after retries — report as available with caveat (NXDOMAIN is strong signal)
			const r: DomainCheckResult = { domain, records: [], status: 'available', method: 'dig', error: 'whois failed after retries' };
			cacheResult(r);
			return r;
		} catch (err) {
			return {
				domain,
				records: [],
				status: 'error',
				error: err instanceof Error ? err.message : String(err),
			};
		}
	})();

	_pendingChecks.set(domain, promise);
	promise.finally(() => _pendingChecks.delete(domain));
	return promise;
}

/** Process domains with concurrency limit, aborting on signal */
async function runConcurrent<T>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<void>,
	signal?: AbortSignal,
): Promise<void> {
	const queue = [...items];
	const active = new Set<Promise<void>>();

	while ((queue.length > 0 || active.size > 0) && !signal?.aborted) {
		while (queue.length > 0 && active.size < concurrency && !signal?.aborted) {
			const item = queue.shift()!;
			const task = fn(item).finally(() => active.delete(task));
			active.add(task);
		}
		if (active.size > 0) {
			await Promise.race(active);
		}
	}
}

/** Batch check — returns all at once */
async function checkBatch(domains: string[]): Promise<DomainCheckResult[]> {
	const results: DomainCheckResult[] = [];
	await runConcurrent(domains, MAX_CONCURRENT_DIG, async (domain) => {
		results.push(await checkDomain(domain));
	});
	return results;
}

/** SSE endpoint: streams results as they complete, aborts on client disconnect */
async function handleStream(domains: string[], signal?: AbortSignal): Promise<Response> {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			let done = 0;

			const sendEvent = (data: object) => {
				if (signal?.aborted) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// Controller closed (client disconnected)
				}
			};

			sendEvent({ type: 'start', total: domains.length });

			await runConcurrent(domains, MAX_CONCURRENT_DIG, async (domain) => {
				if (signal?.aborted) return;
				const result = await checkDomain(domain);
				done++;
				sendEvent({ type: 'result', ...result, progress: done });
			}, signal);

			sendEvent({ type: 'done', total: domains.length });
			try { controller.close(); } catch { /* already closed */ }
		},
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'Access-Control-Allow-Origin': '*',
		},
	});
}

/** Porkbun TLD pricing cache */
interface TldPricingEntry {
	registration: string;
	renewal: string;
}
let _pricingCache: Record<string, TldPricingEntry> = {};
let _pricingFetchedAt = 0;
let _pricingPromise: Promise<void> | null = null;

/**
 * Per-registrar TLD support sets (without dots).
 * Porkbun derived dynamically from pricing API; others curated from registrar data.
 */
let _registrarTlds: Record<string, string[]> = {};

// Spaceship supported TLDs (470+, from spaceship.com)
const SPACESHIP_TLDS = [
	'abogado','ac','academy','accountant','accountants','actor','ad','adult','agency','ai',
	'airforce','apartments','app','archi','army','art','asia','associates','attorney','auction',
	'audio','auto','autos','baby','band','bar','barcelona','bargains','beauty','beer','best',
	'bet','bike','bingo','bio','biz','black','blackfriday','blog','blue','boats','bond','boo',
	'boston','bot','boutique','broker','build','builders','business','buzz','ca','cab','cafe',
	'cam','camera','camp','capital','car','cards','care','careers','cars','casa','cash','casino',
	'cat','catering','cc','center','ceo','cfd','channel','charity','chat','cheap','christmas',
	'church','city','claims','cleaning','click','clinic','clothing','cloud','club','co','coach',
	'codes','coffee','college','com','community','company','compare','computer','condos',
	'construction','consulting','contact','contractors','cooking','cool','country','coupons',
	'courses','credit','creditcard','cricket','cruises','cv','cymru','cyou','dad','dance','date',
	'dating','day','de','deal','dealer','deals','degree','delivery','democrat','dental','dentist',
	'design','dev','diamonds','diet','digital','direct','directory','discount','diy','doctor',
	'dog','domains','download','eco','education','email','energy','engineer','engineering',
	'enterprises','equipment','esq','estate','eu','events','exchange','expert','exposed','express',
	'fail','faith','family','fan','fans','farm','fashion','fast','feedback','finance','financial',
	'fish','fishing','fit','fitness','flights','florist','flowers','fm','foo','food','football',
	'forex','forsale','forum','foundation','free','fun','fund','furniture','futbol','fyi','gallery',
	'game','games','garden','gay','gg','gifts','gives','giving','glass','global','gmbh','gold',
	'golf','graphics','gratis','green','gripe','group','guide','guitars','guru','hair','haus',
	'health','healthcare','help','hiphop','hiv','hockey','holdings','holiday','homes','horse',
	'hospital','host','hosting','hot','house','how','icu','id','im','immo','immobilien','in',
	'inc','industries','info','ing','ink','institute','insure','international','investments','io',
	'irish','je','jetzt','jewelry','kaufen','kids','kim','kitchen','land','lat','law','lawyer',
	'lease','legal','lgbt','life','lifestyle','lighting','limited','limo','link','live','living',
	'llc','loan','loans','locker','lol','london','lotto','love','ltd','luxe','luxury','maison',
	'makeup','management','market','marketing','markets','mba','me','media','meme','memorial',
	'men','miami','mobi','mobile','moda','mom','money','monster','mortgage','motorcycles','mov',
	'movie','music','my','navy','net','network','new','news','nexus','ninja','now','nyc',
	'observer','one','online','org','page','partners','parts','party','pet','phd','photo',
	'photography','photos','pics','pictures','pink','pizza','place','plumbing','plus','poker',
	'porn','press','pro','productions','prof','promo','properties','property','protection','pub',
	'pw','quest','racing','realty','recipes','red','rehab','reise','reisen','rent','rentals',
	'repair','report','republican','rest','restaurant','review','reviews','rip','rocks','rodeo',
	'rsvp','run','sale','salon','sarl','sbs','school','schule','science','security','select',
	'services','sex','sexy','sh','shiksha','shoes','shop','shopping','show','singles','site',
	'ski','skin','soccer','social','software','solar','solutions','soy','space','spot','storage',
	'store','stream','studio','study','style','supplies','supply','support','surf','surgery',
	'systems','talk','tattoo','tax','taxi','team','tech','technology','tel','tennis','theater',
	'theatre','tickets','tienda','tips','tires','to','today','tools','top','tours','town','toys',
	'trade','trading','training','tv','uk','university','uno','us','vacations','vana','ventures',
	'vet','viajes','video','villas','vin','vip','vision','vodka','vote','voto','voyage','wales',
	'watch','webcam','website','wedding','wiki','win','wine','work','works','world','wtf','xxx',
	'xyz','yachts','yoga','you','zip','zone',
];

// Namecheap supported TLDs (520+, from namecheap.com)
const NAMECHEAP_TLDS = [
	'ac','academy','accountant','accountants','actor','ad','adult','africa','agency','ai',
	'airforce','apartments','app','archi','army','art','asia','associates','attorney','auction',
	'audio','auto','autos','baby','band','bar','barcelona','bargains','beauty','beer','berlin',
	'best','bet','bid','bike','bingo','bio','biz','black','blackfriday','blog','blue','boats',
	'bond','boo','boston','bot','boutique','broker','build','builders','business','buzz','bz','ca',
	'cab','cafe','cam','camera','camp','capital','car','cards','care','careers','cars','casa',
	'cash','casino','cat','catering','cc','center','ceo','cfd','ch','channel','charity','chat',
	'cheap','christmas','church','city','claims','cleaning','click','clinic','clothing','cloud',
	'club','cm','cn','co','coach','codes','coffee','college','com','community','company',
	'computer','condos','construction','consulting','contact','contractors','cooking','cool',
	'country','coupons','courses','credit','creditcard','cricket','cruises','cv','cx','cymru',
	'cyou','dad','dance','date','dating','day','de','deal','dealer','deals','degree','delivery',
	'democrat','dental','dentist','desi','design','dev','diamonds','diet','digital','direct',
	'directory','discount','diy','doctor','dog','domains','download','earth','eco','education',
	'email','energy','engineer','engineering','enterprises','equipment','es','esq','estate','eu',
	'events','exchange','expert','exposed','express','fail','faith','family','fan','fans','farm',
	'fashion','fast','feedback','film','finance','financial','fish','fishing','fit','fitness',
	'flights','florist','flowers','fm','foo','food','football','forex','forsale','forum',
	'foundation','fr','free','fun','fund','furniture','futbol','fyi','gallery','game','games',
	'garden','gay','gdn','gg','gift','gifts','gives','giving','glass','global','gmbh','gold',
	'golf','graphics','gratis','green','gripe','group','guide','guitars','guru','hair','hamburg',
	'haus','health','healthcare','help','hiphop','hockey','holdings','holiday','homes','horse',
	'hospital','host','hosting','hot','house','how','icu','id','im','immo','immobilien','in',
	'inc','industries','info','ing','ink','institute','insure','international','investments','io',
	'irish','is','jetzt','jewelry','juegos','kaufen','kids','kim','kitchen','kiwi','krd','kyoto',
	'la','land','lat','law','lawyer','lease','legal','lgbt','li','life','lifestyle','lighting',
	'limited','limo','link','live','living','llc','loan','loans','locker','lol','london','love',
	'ltd','ltda','luxury','maison','makeup','management','market','marketing','markets','mba',
	'me','media','melbourne','meme','memorial','men','menu','miami','mobi','mobile','moda','moe',
	'mom','money','monster','mortgage','motorcycles','mov','movie','music','mx','my','nagoya',
	'name','navy','net','network','new','news','nexus','ngo','ninja','nl','now','nu','nyc',
	'observer','okinawa','one','ong','onl','online','org','osaka','page','paris','partners',
	'parts','party','pe','pet','ph','phd','photo','photography','photos','pics','pictures','pink',
	'pizza','place','plumbing','plus','poker','porn','press','pro','productions','prof','promo',
	'properties','property','protection','pub','pw','quest','racing','realty','recipes','red',
	'rehab','reise','reisen','rent','rentals','repair','report','republican','rest','restaurant',
	'review','reviews','rip','rocks','rodeo','rsvp','run','ryukyu','sale','salon','sarl','sbs',
	'school','schule','science','security','services','sex','sexy','sg','sh','shiksha','shoes',
	'shop','shopping','show','singles','site','ski','skin','so','soccer','social','software',
	'solar','solutions','soy','space','spot','storage','store','stream','studio','study','style',
	'sucks','supplies','supply','support','surf','surgery','sydney','systems','talk','tattoo',
	'tax','taxi','team','tech','technology','tel','tennis','theater','theatre','tickets','tienda',
	'tips','tires','to','today','tokyo','tools','top','tours','town','toys','trade','trading',
	'training','travel','tube','tv','uk','university','uno','us','vacations','vana','vc','vegas',
	'ventures','vet','viajes','video','villas','vin','vip','vision','vodka','vote','voting',
	'voto','voyage','wales','watch','webcam','website','wedding','wiki','win','wine','work',
	'works','world','ws','wtf','xxx','xyz','yachts','yoga','yokohama','you','zip','zone',
];

// Cloudflare supported TLDs (350+, from cloudflare.com/tld-policies)
const CLOUDFLARE_TLDS = [
	'academy','accountant','accountants','actor','agency','airforce','apartments','app','army',
	'associates','attorney','auction','band','bar','bargains','beer','bet','bid','bike','bingo',
	'biz','black','blog','blue','boo','boston','boutique','broker','builders','business','ca',
	'cab','cafe','camera','camp','capital','cards','care','careers','casa','cash','casino',
	'catering','cc','center','ceo','chat','cheap','church','city','claims','cleaning','clinic',
	'clothing','cloud','club','co','coach','codes','coffee','college','com','community','company',
	'compare','computer','condos','construction','consulting','contact','contractors','cooking',
	'cool','coupons','credit','creditcard','cricket','cruises','dad','dance','date','dating',
	'day','deals','degree','delivery','democrat','dental','dentist','design','dev','diamonds',
	'digital','direct','directory','discount','doctor','dog','domains','download','education',
	'email','energy','engineer','engineering','enterprises','equipment','esq','estate','events',
	'exchange','expert','express','fail','faith','family','fans','farm','fashion','finance',
	'financial','fish','fishing','fit','fitness','flights','florist','fm','foo','football','forex',
	'forsale','foundation','fun','fund','furniture','futbol','fyi','gallery','games','garden',
	'gifts','gives','glass','gmbh','gold','golf','graphics','gratis','green','gripe','group',
	'guide','guru','haus','health','healthcare','hockey','holdings','holiday','horse','hospital',
	'host','house','how','immo','immobilien','inc','industries','info','ink','institute','insure',
	'international','investments','io','irish','jetzt','jewelry','kaufen','kim','kitchen','land',
	'lawyer','lease','legal','lgbt','life','lighting','limited','limo','link','live','loan',
	'loans','love','ltd','luxe','maison','management','market','marketing','markets','mba','me',
	'media','memorial','men','miami','mobi','moda','money','mortgage','mov','movie','mx','navy',
	'net','network','new','news','nexus','ninja','observer','one','online','org','page','partners',
	'parts','party','pet','phd','photography','photos','pictures','pink','pizza','place','plumbing',
	'plus','press','pro','productions','prof','promo','properties','pub','racing','realty',
	'recipes','red','rehab','reise','reisen','rent','rentals','repair','report','republican',
	'rest','restaurant','review','reviews','rip','rocks','rodeo','rsvp','run','sale','salon',
	'sarl','school','schule','science','security','select','services','shoes','shop','shopping',
	'show','singles','site','soccer','social','software','solar','solutions','soy','space',
	'storage','store','stream','studio','style','supplies','supply','support','surf','surgery',
	'systems','tax','taxi','team','tech','technology','tennis','theater','theatre','tienda','tips',
	'tires','today','tools','tours','town','toys','trade','trading','training','travel','tv','uk',
	'university','us','vacations','ventures','vet','viajes','video','villas','vin','vip','vision',
	'vodka','voyage','watch','webcam','website','wedding','wiki','win','wine','work','works',
	'world','wtf','xyz','yoga','zone',
];

/** Fetch TLD pricing from Porkbun (public, no auth needed) */
async function fetchPricing(): Promise<void> {
	// Deduplicate concurrent fetches
	if (_pricingPromise) return _pricingPromise;
	_pricingPromise = (async () => {
		try {
			const res = await fetch('https://api.porkbun.com/api/json/v3/domain/pricing', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			const data = await res.json() as { status: string; pricing?: Record<string, { registration?: string; renewal?: string }> };
			if (data.status === 'SUCCESS' && data.pricing) {
				const parsed: Record<string, TldPricingEntry> = {};
				for (const [tld, prices] of Object.entries(data.pricing)) {
					parsed[tld] = {
						registration: prices.registration || '0',
						renewal: prices.renewal || '0',
					};
				}
				_pricingCache = parsed;
				_pricingFetchedAt = Date.now();
				// Build registrar TLD support from Porkbun response + curated lists
				const porkbunTlds = Object.keys(parsed);
				_registrarTlds = {
					porkbun: porkbunTlds,
					namecheap: NAMECHEAP_TLDS,
					spaceship: SPACESHIP_TLDS,
					cloudflare: CLOUDFLARE_TLDS,
				};
				console.log(`Pricing cached: ${porkbunTlds.length} TLDs, registrar support built`);
			}
		} catch (err) {
			console.error('Failed to fetch pricing:', err);
		} finally {
			_pricingPromise = null;
		}
	})();
	return _pricingPromise;
}

/** Get cached pricing, refresh if stale */
async function getPricing(): Promise<{ pricing: Record<string, TldPricingEntry>; registrars: Record<string, string[]> }> {
	if (Date.now() - _pricingFetchedAt > PRICING_TTL_MS) {
		await fetchPricing();
	}
	return { pricing: _pricingCache, registrars: _registrarTlds };
}

// Pre-warm pricing cache on startup
fetchPricing();

Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders });
		}

		if (url.pathname === '/api/health') {
			return Response.json({ ok: true, pid: process.pid, cacheSize: _resultCache.size }, { headers: corsHeaders });
		}

		if (url.pathname === '/api/pricing' && req.method === 'GET') {
			const data = await getPricing();
			return Response.json(data, { headers: corsHeaders });
		}

		if ((url.pathname === '/api/check' || url.pathname === '/api/stream') && req.method === 'POST') {
			const body = (await req.json()) as CheckRequest;
			if (!body.domains?.length) {
				return Response.json({ error: 'domains array required' }, { status: 400, headers: corsHeaders });
			}
			const domains = body.domains
				.filter((d): d is string => typeof d === 'string' && VALID_DOMAIN.test(d))
				.slice(0, MAX_DOMAINS_PER_REQUEST);
			if (domains.length === 0) {
				return Response.json({ error: 'no valid domains provided' }, { status: 400, headers: corsHeaders });
			}

			if (url.pathname === '/api/check') {
				const results = await checkBatch(domains);
				return Response.json({ results }, { headers: corsHeaders });
			}
			return handleStream(domains, req.signal);
		}

		return Response.json({ error: 'not found' }, { status: 404, headers: corsHeaders });
	},
});

console.log(`digr API server running on http://localhost:${PORT}`);
console.log(`  POST /api/check   — batch domain check (dig + whois)`);
console.log(`  POST /api/stream  — SSE streaming check`);
console.log(`  GET  /api/pricing — TLD pricing (Porkbun, 1hr cache)`);
console.log(`  GET  /api/health  — health check`);
