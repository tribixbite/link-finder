#!/usr/bin/env node
/**
 * findurlink — Local DNS API server for findur.link
 * Runs dig + whois lookups for domain availability checking.
 * Works with both Bun and Node.js (>=18).
 *
 * Usage: npx findurlink
 *        npx findurlink -p 4000
 *        PORT=3001 findurlink
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';

const execFileAsync = promisify(execFile);

/** Parse --port / -p from argv or PORT env */
function parseExplicitPort() {
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) return parseInt(args[i + 1], 10);
		if (args[i].startsWith('--port=')) return parseInt(args[i].split('=')[1], 10);
	}
	if (process.env.PORT) return parseInt(process.env.PORT, 10);
	return null; // null = auto-scan
}

/** Check if a port is free */
function isPortFree(port) {
	return new Promise((resolve) => {
		const conn = createConnection({ port, host: '127.0.0.1' });
		conn.on('connect', () => { conn.destroy(); resolve(false); });
		conn.on('error', () => resolve(true));
		setTimeout(() => { conn.destroy(); resolve(true); }, 200);
	});
}

const CANDIDATE_PORTS = [3001, 3002, 3003, 3004, 3005, 3010, 3100, 4001, 8001];

/** Find an available port — auto-scans candidates, always succeeds */
async function findPort(explicit) {
	// If explicitly set, try that first then auto-scan
	const ports = explicit
		? [explicit, ...CANDIDATE_PORTS.filter(p => p !== explicit)]
		: CANDIDATE_PORTS;

	for (const port of ports) {
		if (await isPortFree(port)) return port;
		if (port === explicit) console.log(`\x1b[33mPort ${port} in use, trying next...\x1b[0m`);
	}
	// Last resort: let OS pick
	return 0;
}

const EXPLICIT_PORT = parseExplicitPort();
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_CONCURRENT_DIG = 12;
const MAX_CONCURRENT_WHOIS = 4;
const DIG_TIMEOUT_MS = 5000;
const WHOIS_TIMEOUT_MS = 8000;
const WHOIS_MAX_RETRIES = 3;
const WHOIS_RETRY_BASE_DELAY_MS = 1000;
const WHOIS_MIN_GAP_MS = 500;
const MAX_DOMAINS_PER_REQUEST = 500;
const RESULT_CACHE_TTL_MS = 15 * 60 * 1000;
const VALID_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/i;
const PRICING_TTL_MS = 60 * 60 * 1000;

// --- Registrar TLD lists (inlined from registrar-tlds.ts) ---
const SPACESHIP_TLDS = ['abogado','ac','academy','accountant','accountants','actor','ad','adult','agency','ai','airforce','apartments','app','archi','army','art','asia','associates','attorney','auction','audio','auto','autos','baby','band','bar','barcelona','bargains','beauty','beer','best','bet','bid','bike','bingo','bio','biz','black','blackfriday','blog','blue','boats','bond','boo','boston','bot','boutique','broker','build','builders','business','buzz','bz','ca','cab','cafe','cam','camera','camp','capital','car','cards','care','careers','cars','casa','cash','casino','catering','cc','center','ceo','cfd','channel','charity','chat','cheap','christmas','church','city','claims','cleaning','click','clinic','clothing','cloud','club','cm','co','coach','codes','coffee','college','com','community','company','compare','computer','condos','construction','consulting','contact','contractors','cooking','cool','country','coupons','courses','credit','creditcard','cricket','cruises','cv','cx','cymru','cyou','dad','dance','date','dating','day','de','deal','dealer','deals','degree','delivery','democrat','dental','dentist','desi','design','dev','diamonds','diet','digital','direct','directory','discount','diy','doctor','dog','domains','download','earth','eco','education','email','energy','engineer','engineering','enterprises','equipment','es','esq','estate','eu','events','exchange','expert','exposed','express','fail','faith','family','fan','fans','farm','fashion','fast','feedback','film','finance','financial','fish','fishing','fit','fitness','flights','florist','flowers','fm','foo','food','football','forex','forsale','forum','foundation','fr','free','fun','fund','furniture','futbol','fyi','gallery','game','games','garden','gay','gdn','gg','gift','gifts','gives','giving','glass','global','gmbh','gold','golf','graphics','gratis','green','gripe','group','guide','guitars','guru','hair','hamburg','haus','health','healthcare','help','hiphop','hiv','hockey','holdings','holiday','homes','horse','hospital','host','hosting','hot','house','how','icu','id','im','immo','immobilien','in','inc','industries','info','ing','ink','institute','insure','international','investments','io','irish','is','it','je','jetzt','jewelry','juegos','kaufen','kids','kim','kitchen','kiwi','krd','kyoto','la','land','lat','law','lawyer','lease','legal','lgbt','li','life','lifestyle','lighting','limited','limo','link','live','living','llc','loan','loans','locker','lol','london','lotto','love','ltd','ltda','luxe','luxury','ly','maison','makeup','management','market','marketing','markets','mba','me','media','melbourne','meme','memorial','men','menu','miami','mobi','mobile','moda','moe','mom','money','monster','mortgage','motorcycles','mov','movie','music','mx','my','nagoya','name','navy','net','network','new','news','nexus','ngo','ninja','nl','now','nu','nyc','observer','okinawa','one','ong','onl','online','org','osaka','page','paris','partners','parts','party','pe','pet','ph','phd','photo','photography','photos','pics','pictures','pink','pizza','place','plumbing','plus','poker','porn','press','pro','productions','prof','promo','properties','property','protection','pub','pw','quest','racing','realty','recipes','red','rehab','reise','reisen','rent','rentals','repair','report','republican','rest','restaurant','review','reviews','rip','rocks','rodeo','rsvp','run','ryukyu','sale','salon','sarl','sbs','school','schule','science','security','select','services','sex','sexy','sg','sh','shiksha','shoes','shop','shopping','show','singles','site','ski','skin','so','soccer','social','software','solar','solutions','soy','space','spot','storage','store','stream','studio','study','style','sucks','supplies','supply','support','surf','surgery','sydney','systems','talk','tattoo','tax','taxi','team','tech','technology','tel','tennis','theater','theatre','tickets','tienda','tips','tires','to','today','tokyo','tools','top','tours','town','toys','trade','trading','training','travel','tube','tv','uk','university','uno','us','vacations','vana','vc','vegas','ventures','vet','viajes','video','villas','vin','vip','vision','vodka','vote','voting','voto','voyage','wales','watch','webcam','website','wedding','wiki','win','wine','work','works','world','ws','wtf','xxx','xyz','yachts','yoga','yokohama','you','zip','zone'];

const NAMECHEAP_TLDS = ['ac','academy','accountant','accountants','actor','adult','agency','ai','airforce','apartments','app','archi','army','art','asia','associates','attorney','auction','audio','auto','band','bar','bargains','beauty','beer','best','bet','bid','bike','bingo','bio','biz','black','blackfriday','blog','blue','boats','bond','boo','boston','boutique','broker','build','builders','business','buzz','bz','ca','cab','cafe','cam','camera','camp','capital','car','cards','care','careers','cars','casa','cash','casino','cat','catering','cc','center','ceo','cfd','channel','charity','chat','cheap','christmas','church','city','claims','cleaning','click','clinic','clothing','cloud','club','cm','co','coach','codes','coffee','college','com','community','company','compare','computer','condos','construction','consulting','contact','contractors','cooking','cool','country','coupons','courses','credit','creditcard','cricket','cruises','cx','cymru','cyou','dad','dance','date','dating','day','de','deal','dealer','deals','degree','delivery','democrat','dental','dentist','desi','design','dev','diamonds','diet','digital','direct','directory','discount','diy','doctor','dog','domains','download','earth','eco','education','email','energy','engineer','engineering','enterprises','equipment','es','esq','estate','eu','events','exchange','expert','exposed','express','fail','faith','family','fan','fans','farm','fashion','feedback','film','finance','financial','fish','fishing','fit','fitness','flights','florist','flowers','fm','foo','food','football','forex','forsale','forum','foundation','fr','free','fun','fund','furniture','futbol','fyi','gallery','game','games','garden','gay','gdn','gg','gift','gifts','gives','glass','global','gmbh','gold','golf','graphics','gratis','green','gripe','group','guide','guitars','guru','hair','haus','health','healthcare','help','hiphop','hiv','hockey','holdings','holiday','homes','horse','hospital','host','hosting','hot','house','how','icu','id','im','immo','immobilien','in','inc','industries','info','ing','ink','institute','insure','international','investments','io','irish','is','it','je','jetzt','jewelry','juegos','kaufen','kids','kim','kitchen','kiwi','krd','la','land','lat','law','lawyer','lease','legal','lgbt','li','life','lifestyle','lighting','limited','limo','link','live','living','llc','loan','loans','lol','london','lotto','love','ltd','ltda','luxe','luxury','ly','maison','makeup','management','market','marketing','mba','me','media','melbourne','meme','memorial','men','menu','miami','mobi','moda','moe','mom','money','monster','mortgage','motorcycles','mov','movie','mx','my','nagoya','name','navy','net','network','new','news','nexus','ngo','ninja','nl','now','nu','nyc','observer','okinawa','one','ong','onl','online','org','osaka','page','paris','partners','parts','party','pe','pet','ph','phd','photo','photography','photos','pics','pictures','pink','pizza','place','plumbing','plus','poker','porn','press','pro','productions','prof','promo','properties','property','protection','pub','pw','quest','racing','realty','recipes','red','rehab','reise','reisen','rent','rentals','repair','report','republican','rest','restaurant','review','reviews','rip','rocks','rodeo','rsvp','run','ryukyu','sale','salon','sarl','sbs','school','schule','science','security','select','services','sex','sexy','sg','sh','shiksha','shoes','shop','shopping','show','singles','site','ski','skin','so','soccer','social','software','solar','solutions','soy','space','spot','storage','store','stream','studio','study','style','sucks','supplies','supply','support','surf','surgery','sydney','systems','talk','tattoo','tax','taxi','team','tech','technology','tel','tennis','theater','theatre','tickets','tienda','tips','tires','to','today','tokyo','tools','top','tours','town','toys','trade','trading','training','travel','tube','tv','uk','university','uno','us','vacations','vc','vegas','ventures','vet','viajes','video','villas','vin','vip','vision','vodka','vote','voting','voto','voyage','wales','watch','webcam','website','wedding','wiki','win','wine','work','works','world','ws','wtf','xxx','xyz','yachts','yoga','yokohama','you','zip','zone'];

const CLOUDFLARE_TLDS = ['ac','academy','accountants','actor','adult','agency','apartments','app','art','asia','associates','attorney','auction','auto','band','bar','bargains','beer','best','bet','bid','bike','bingo','bio','biz','black','blog','blue','boats','bond','boo','boston','boutique','build','builders','business','buzz','bz','cab','cafe','cam','camera','camp','capital','car','cards','care','careers','cars','casa','cash','casino','catering','cc','center','ceo','cfd','channel','chat','cheap','christmas','church','city','claims','cleaning','click','clinic','clothing','cloud','club','co','coach','codes','coffee','college','com','community','company','computer','condos','construction','consulting','contact','contractors','cooking','cool','country','coupons','courses','credit','creditcard','cruises','cx','cyou','dad','dance','date','dating','day','deal','dealer','deals','degree','delivery','democrat','dental','dentist','desi','design','dev','diamonds','diet','digital','direct','directory','discount','diy','doctor','dog','domains','download','earth','eco','education','email','energy','engineer','engineering','enterprises','equipment','esq','estate','eu','events','exchange','expert','exposed','express','fail','faith','family','fan','fans','farm','fashion','feedback','film','finance','financial','fish','fishing','fit','fitness','flights','florist','flowers','foo','food','football','forex','forsale','forum','foundation','free','fun','fund','furniture','futbol','fyi','gallery','game','games','garden','gay','gg','gift','gifts','gives','glass','global','gmbh','gold','golf','graphics','gratis','green','gripe','group','guide','guitars','guru','hair','haus','health','healthcare','help','hiphop','hiv','hockey','holdings','holiday','homes','horse','hospital','host','hosting','hot','house','how','icu','im','immo','inc','industries','info','ing','ink','institute','insure','international','investments','io','irish','it','jetzt','jewelry','juegos','kaufen','kids','kim','kitchen','kiwi','la','land','lat','law','lawyer','lease','legal','lgbt','li','life','lighting','limited','limo','link','live','living','llc','loan','loans','lol','london','lotto','love','ltd','luxe','luxury','maison','makeup','management','market','marketing','mba','me','media','melbourne','meme','memorial','men','menu','mobi','moda','moe','mom','money','monster','mortgage','motorcycles','mov','movie','mx','nagoya','name','navy','net','network','new','news','nexus','ngo','ninja','now','nyc','observer','okinawa','one','ong','onl','online','org','osaka','page','paris','partners','parts','party','pet','phd','photo','photography','photos','pics','pictures','pink','pizza','place','plumbing','plus','poker','porn','press','pro','productions','prof','promo','properties','property','protection','pub','pw','quest','racing','recipes','red','rehab','reise','reisen','rent','rentals','repair','report','republican','rest','restaurant','review','reviews','rip','rocks','rodeo','rsvp','run','ryukyu','sale','salon','sarl','sbs','school','schule','science','security','select','services','sex','sexy','sh','shiksha','shoes','shop','shopping','show','singles','site','ski','skin','soccer','social','software','solar','solutions','soy','space','storage','store','stream','studio','study','style','sucks','supplies','supply','support','surf','surgery','sydney','systems','tattoo','tax','taxi','team','tech','technology','tel','tennis','theater','theatre','tienda','tips','tires','today','tokyo','tools','top','tours','town','toys','trade','trading','training','travel','tube','tv','uk','university','uno','us','vacations','vc','vegas','ventures','vet','viajes','video','villas','vin','vip','vision','vodka','vote','voting','voto','voyage','wales','watch','webcam','website','wedding','wiki','win','wine','work','works','world','ws','wtf','xxx','xyz','yachts','yoga','yokohama','you','zip','zone'];

// --- Whois patterns ---
const WHOIS_AVAILABLE = [/no match/i,/not found/i,/no data found/i,/no entries found/i,/status:\s*free/i,/is available/i,/domain not found/i,/no object found/i,/nothing found/i,/^%% no matching objects/im];
const WHOIS_RESERVED = [/reserved domain/i,/status:\s*reserved/i,/serverhold/i];
const WHOIS_REGISTERED = [/registrar:/i,/creation date:/i,/registry domain id:/i,/registered on:/i,/created:/i];

// --- Rate limiting ---
const _rateLimits = new Map();
function isRateLimited(ip) {
	const now = Date.now();
	const entry = _rateLimits.get(ip);
	if (!entry || now > entry.resetAt) {
		_rateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
		return false;
	}
	entry.count++;
	return entry.count > 100;
}
setInterval(() => {
	const now = Date.now();
	for (const [ip, entry] of _rateLimits) {
		if (now > entry.resetAt) _rateLimits.delete(ip);
	}
}, 120_000);

// --- Result cache ---
const _resultCache = new Map();
function getCachedResult(domain) {
	const entry = _resultCache.get(domain);
	if (!entry) return null;
	if (Date.now() - entry.cachedAt > RESULT_CACHE_TTL_MS) { _resultCache.delete(domain); return null; }
	return entry.result;
}
function cacheResult(result) {
	if (result.status === 'error') return;
	_resultCache.set(result.domain, { result, cachedAt: Date.now() });
}
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of _resultCache) {
		if (now - entry.cachedAt > RESULT_CACHE_TTL_MS) _resultCache.delete(key);
	}
}, 300_000);

// --- Whois cooldown ---
const _whoisLastReq = new Map();
function extractTld(domain) { const dot = domain.lastIndexOf('.'); return dot >= 0 ? domain.slice(dot + 1) : domain; }
async function whoisCooldown(domain) {
	const tld = extractTld(domain);
	const last = _whoisLastReq.get(tld) ?? 0;
	const elapsed = Date.now() - last;
	if (elapsed < WHOIS_MIN_GAP_MS) await new Promise(r => setTimeout(r, WHOIS_MIN_GAP_MS - elapsed));
	_whoisLastReq.set(tld, Date.now());
}

// --- exec helpers (node child_process) ---
async function digCheck(domain) {
	try {
		const { stdout } = await execFileAsync('dig', ['+noall', '+comments', '+answer', '+time=3', '+tries=1', domain], { timeout: DIG_TIMEOUT_MS });
		const lines = stdout.trim().split('\n').filter(Boolean);
		const nxdomain = lines.some(l => /status:\s*NXDOMAIN/i.test(l));
		const records = lines.filter(l => !l.startsWith(';') && l.includes('\t'));
		return { nxdomain, records: records.map(r => r.split('\t').pop()?.trim() || r) };
	} catch {
		return { nxdomain: false, records: [] };
	}
}

async function whoisCheckOnce(domain) {
	try {
		const { stdout } = await execFileAsync('whois', [domain], { timeout: WHOIS_TIMEOUT_MS });
		for (const p of WHOIS_RESERVED) if (p.test(stdout)) return 'reserved';
		for (const p of WHOIS_REGISTERED) if (p.test(stdout)) return 'taken';
		for (const p of WHOIS_AVAILABLE) if (p.test(stdout)) return 'available';
		return stdout.trim().length > 50 ? 'taken' : 'error';
	} catch {
		return 'error';
	}
}

async function whoisCheck(domain) {
	for (let attempt = 1; attempt <= WHOIS_MAX_RETRIES; attempt++) {
		await whoisCooldown(domain);
		const result = await whoisCheckOnce(domain);
		if (result !== 'error') return result;
		if (attempt < WHOIS_MAX_RETRIES) await new Promise(r => setTimeout(r, WHOIS_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
	}
	return 'error';
}

// --- Dedup ---
const _pendingChecks = new Map();

async function checkDomain(domain) {
	const cached = getCachedResult(domain);
	if (cached) return cached;
	const pending = _pendingChecks.get(domain);
	if (pending) return pending;

	const promise = (async () => {
		try {
			const dig = await digCheck(domain);
			if (dig.records.length > 0) { const r = { domain, records: dig.records, status: 'taken', method: 'dig' }; cacheResult(r); return r; }
			if (!dig.nxdomain) { const r = { domain, records: [], status: 'taken', method: 'dig' }; cacheResult(r); return r; }
			const whois = await whoisCheck(domain);
			if (whois === 'reserved') { const r = { domain, records: [], status: 'reserved', method: 'whois' }; cacheResult(r); return r; }
			if (whois === 'taken') { const r = { domain, records: [], status: 'taken', method: 'whois' }; cacheResult(r); return r; }
			if (whois === 'available') { const r = { domain, records: [], status: 'available', method: 'whois' }; cacheResult(r); return r; }
			const r = { domain, records: [], status: 'available', method: 'dig', error: 'whois failed after retries' }; cacheResult(r); return r;
		} catch (err) {
			return { domain, records: [], status: 'error', error: err instanceof Error ? err.message : String(err) };
		}
	})();
	_pendingChecks.set(domain, promise);
	promise.finally(() => _pendingChecks.delete(domain));
	return promise;
}

// --- Concurrency ---
async function runConcurrent(items, concurrency, fn, signal) {
	const queue = [...items];
	const active = new Set();
	while ((queue.length > 0 || active.size > 0) && !signal?.aborted) {
		while (queue.length > 0 && active.size < concurrency && !signal?.aborted) {
			const item = queue.shift();
			const task = fn(item).finally(() => active.delete(task));
			active.add(task);
		}
		if (active.size > 0) await Promise.race(active);
	}
}

// --- Whois detail ---
function parseWhoisFields(raw) {
	const lines = raw.split('\n');
	const result = {};
	const nameservers = [];
	const statuses = [];
	for (const line of lines) {
		const lower = line.toLowerCase().trim();
		const value = line.split(':').slice(1).join(':').trim();
		if (!value) continue;
		if (lower.startsWith('registrar:') && !result.registrar) result.registrar = value;
		else if ((lower.startsWith('creation date:') || lower.startsWith('created:') || lower.startsWith('registered on:')) && !result.created) result.created = value;
		else if ((lower.startsWith('registry expiry date:') || lower.startsWith('expiration date:') || lower.startsWith('expires:') || lower.startsWith('expiry date:')) && !result.expires) result.expires = value;
		else if ((lower.startsWith('updated date:') || lower.startsWith('last updated:')) && !result.updated) result.updated = value;
		else if (lower.startsWith('name server:') || lower.startsWith('nserver:')) nameservers.push(value.toLowerCase());
		else if (lower.startsWith('domain status:') || lower.startsWith('status:')) statuses.push(value);
	}
	if (nameservers.length > 0) result.nameservers = nameservers;
	if (statuses.length > 0) result.status = statuses;
	return result;
}

async function runWhoisDetail(domain) {
	await whoisCooldown(domain);
	const { stdout } = await execFileAsync('whois', [domain], { timeout: WHOIS_TIMEOUT_MS });
	return { domain, raw: stdout, parsed: parseWhoisFields(stdout), fetchedAt: Date.now() };
}

// --- Pricing ---
let _pricingCache = {};
let _pricingFetchedAt = 0;
let _pricingPromise = null;
let _registrarTlds = {};

async function fetchPricing() {
	if (_pricingPromise) return _pricingPromise;
	_pricingPromise = (async () => {
		try {
			const res = await fetch('https://api.porkbun.com/api/json/v3/domain/pricing', {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
			});
			const data = await res.json();
			if (data.status === 'SUCCESS' && data.pricing) {
				const parsed = {};
				for (const [tld, prices] of Object.entries(data.pricing)) {
					parsed[tld] = { registration: prices.registration || '0', renewal: prices.renewal || '0' };
				}
				_pricingCache = parsed;
				_pricingFetchedAt = Date.now();
				const porkbunTlds = Object.keys(parsed);
				_registrarTlds = { porkbun: porkbunTlds, namecheap: NAMECHEAP_TLDS, spaceship: SPACESHIP_TLDS, cloudflare: CLOUDFLARE_TLDS };
				console.log(`Pricing cached: ${porkbunTlds.length} TLDs`);
			}
		} catch (err) { console.error('Failed to fetch pricing:', err); }
		finally { _pricingPromise = null; }
	})();
	return _pricingPromise;
}

async function getPricing() {
	if (Date.now() - _pricingFetchedAt > PRICING_TTL_MS) await fetchPricing();
	return { pricing: _pricingCache, registrars: _registrarTlds };
}

// --- CORS helpers ---
const corsHeaders = {
	'Access-Control-Allow-Origin': CORS_ORIGIN,
	'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
	return { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

// --- HTTP Server (Node.js http module — works in both Node and Bun) ---
async function handleRequest(req) {
	const url = new URL(req.url, `http://localhost:${PORT}`);

	if (req.method === 'OPTIONS') return { status: 204, headers: corsHeaders, body: '' };

	// Rate limiting
	if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') {
		const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
		if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded' }, 429);
	}

	if (url.pathname === '/api/health') return jsonResponse({ ok: true, pid: process.pid, cacheSize: _resultCache.size });

	if (url.pathname === '/api/pricing' && req.method === 'GET') {
		const data = await getPricing();
		return jsonResponse(data);
	}

	if (url.pathname === '/api/whois' && req.method === 'GET') {
		const domain = url.searchParams.get('domain');
		if (!domain || !VALID_DOMAIN.test(domain)) return jsonResponse({ error: 'valid domain parameter required' }, 400);
		try {
			const data = await runWhoisDetail(domain);
			return jsonResponse(data);
		} catch (err) {
			return jsonResponse({ error: err instanceof Error ? err.message : 'Whois lookup failed' }, 500);
		}
	}

	if ((url.pathname === '/api/check' || url.pathname === '/api/stream') && req.method === 'POST') {
		// Read body
		const body = await new Promise((resolve, reject) => {
			let data = '';
			req.on('data', chunk => { data += chunk; });
			req.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
			req.on('error', reject);
		});

		if (!body.domains?.length) return jsonResponse({ error: 'domains array required' }, 400);
		const domains = body.domains.filter(d => typeof d === 'string' && VALID_DOMAIN.test(d)).slice(0, MAX_DOMAINS_PER_REQUEST);
		if (domains.length === 0) return jsonResponse({ error: 'no valid domains provided' }, 400);

		if (url.pathname === '/api/check') {
			const results = [];
			await runConcurrent(domains, MAX_CONCURRENT_DIG, async (domain) => { results.push(await checkDomain(domain)); });
			return jsonResponse({ results });
		}

		// SSE streaming
		return { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }, stream: true, domains };
	}

	return jsonResponse({ error: 'not found' }, 404);
}

// --- Start server ---
const server = createServer(async (req, res) => {
	try {
		const result = await handleRequest(req);

		if (result.stream) {
			// SSE mode
			res.writeHead(200, result.headers);
			const ac = new AbortController();
			req.on('close', () => ac.abort());

			const domains = result.domains;
			let done = 0;
			const send = (data) => { if (!ac.signal.aborted) res.write(`data: ${JSON.stringify(data)}\n\n`); };
			send({ type: 'start', total: domains.length });

			await runConcurrent(domains, MAX_CONCURRENT_DIG, async (domain) => {
				if (ac.signal.aborted) return;
				const r = await checkDomain(domain);
				done++;
				send({ type: 'result', ...r, progress: done });
			}, ac.signal);

			send({ type: 'done', total: domains.length });
			res.end();
			return;
		}

		res.writeHead(result.status, result.headers);
		res.end(result.body);
	} catch (err) {
		res.writeHead(500, corsHeaders);
		res.end(JSON.stringify({ error: err.message || 'Internal error' }));
	}
});

// Check for dig and whois
async function checkDeps() {
	const missing = [];
	for (const cmd of ['dig', 'whois']) {
		try { await execFileAsync('which', [cmd]); } catch { missing.push(cmd); }
	}
	if (missing.length > 0) {
		console.error(`\x1b[31mMissing required commands: ${missing.join(', ')}\x1b[0m`);
		console.error('Install with:');
		if (process.platform === 'linux') {
			console.error('  apt install dnsutils whois      # Debian/Ubuntu');
			console.error('  pkg install dnsutils whois       # Termux');
		} else if (process.platform === 'darwin') {
			console.error('  brew install bind whois');
		}
		process.exit(1);
	}
}

await checkDeps();

const PORT = await findPort(EXPLICIT_PORT);
fetchPricing();

server.listen(PORT, () => {
	const actual = server.address()?.port ?? PORT;
	console.log(`\x1b[36mfindurlink\x1b[0m API server running on \x1b[1mhttp://localhost:${actual}\x1b[0m`);
	console.log(`  Open \x1b[4mhttps://findur.link\x1b[0m — it auto-detects this server`);
	console.log(`  CORS: ${CORS_ORIGIN}`);
	console.log(`  Endpoints:`);
	console.log(`    POST /api/stream  — SSE streaming domain check`);
	console.log(`    POST /api/check   — batch domain check`);
	console.log(`    GET  /api/whois   — whois detail lookup`);
	console.log(`    GET  /api/pricing — TLD pricing`);
	console.log(`    GET  /api/health  — health check`);
});
