import type { DomainCandidate, MutationType, CustomMutation } from './types';

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** Minimum suffix length for domain hacks (skip single-char TLD suffix matches) */
const MIN_HACK_SUFFIX_LENGTH = 2;

/**
 * Curated set of TLDs that form natural word endings — only these generate domain hacks.
 * This dramatically reduces noise from the 470+ TLD list.
 */
const HACKABLE_TLDS = new Set([
	// Common word-ending suffixes
	'.us', '.ly', '.io', '.er', '.ed', '.al', '.an', '.ar', '.as', '.at',
	'.be', '.by', '.ch', '.co', '.de', '.do', '.es', '.eu', '.fm', '.gg',
	'.id', '.ie', '.im', '.in', '.is', '.it', '.la', '.li', '.me', '.my',
	'.na', '.no', '.nu', '.pe', '.ph', '.re', '.rs', '.se', '.sh', '.si',
	'.so', '.to', '.tv', '.uk', '.vc', '.ws',
	// Multi-char word endings
	'.ac', '.ad', '.ag', '.am', '.art', '.bar', '.bio', '.biz', '.buzz',
	'.cam', '.car', '.cc', '.click', '.club', '.cool', '.day',
	'.design', '.dev', '.dog', '.eco', '.email', '.fail', '.fan',
	'.farm', '.fast', '.fish', '.fit', '.fun', '.gay', '.gold',
	'.green', '.guru', '.hair', '.help', '.hiv', '.host', '.hot',
	'.house', '.how', '.icu', '.inc', '.ing', '.ink', '.land',
	'.law', '.life', '.link', '.live', '.lol', '.love', '.men',
	'.mobi', '.mom', '.name', '.net', '.new', '.one', '.org',
	'.page', '.pet', '.pink', '.place', '.pro', '.pub', '.red',
	'.rest', '.rip', '.run', '.sale', '.sex', '.site', '.ski',
	'.social', '.store', '.style', '.surf', '.tax', '.team',
	'.tech', '.top', '.vet', '.video', '.vote', '.watch', '.win',
	'.work', '.world', '.wtf', '.xyz', '.zone',
]);

/** Remove the last vowel from a word. "filter" → "filtr", "scope" → "scop" */
function dropLastVowel(word: string): string | null {
	for (let i = word.length - 1; i >= 0; i--) {
		if (VOWELS.has(word[i])) {
			return word.slice(0, i) + word.slice(i + 1);
		}
	}
	return null; // no vowels to drop
}

/** Remove all vowels. "filter" → "fltr" */
function dropAllVowels(word: string): string | null {
	const result = word.split('').filter(c => !VOWELS.has(c)).join('');
	return result.length >= 2 && result !== word ? result : null;
}

/** Append 'r' if doesn't already end with r. "scope" → "scopr" */
function addR(word: string): string | null {
	return word.endsWith('r') ? null : word + 'r';
}

/** Append 'ly'. "torch" → "torchly" */
function addLy(word: string): string | null {
	return word.endsWith('ly') ? null : word + 'ly';
}

/** Append 'ify'. "torch" → "torchify" */
function addIfy(word: string): string | null {
	return word.endsWith('ify') ? null : word + 'ify';
}

/** Append 'db'. "torch" → "torchdb" */
function addDb(word: string): string | null {
	return word + 'db';
}

/** Append 'hq'. "torch" → "torchhq" */
function addHq(word: string): string | null {
	return word + 'hq';
}

/** Simple pluralization. "spec" → "specs", "torch" → "torches" */
function pluralize(word: string): string | null {
	if (word.endsWith('s')) return null;
	if (/(?:ch|sh|x|z|ss)$/.test(word)) return word + 'es';
	if (word.endsWith('y') && !VOWELS.has(word[word.length - 2])) {
		return word.slice(0, -1) + 'ies';
	}
	return word + 's';
}

/** Double the last consonant. "dig" → "digg" */
function doubleLastLetter(word: string): string | null {
	const last = word[word.length - 1];
	if (!last || VOWELS.has(last) || word.endsWith(last + last)) return null;
	return word + last;
}

/**
 * Domain hack: find TLDs that match the word ending.
 * "delicious" + ".us" → "delicio.us"
 * Only generates hacks for TLDs in the curated HACKABLE_TLDS set, and
 * requires minimum suffix length to avoid noise. Results sorted by
 * quality score (longer suffix matches = higher quality).
 */
export function findDomainHacks(word: string, tlds: string[]): Array<{ name: string; tld: string }> {
	const results: Array<{ name: string; tld: string; score: number }> = [];
	for (const tld of tlds) {
		// Only generate hacks for curated TLDs
		if (!HACKABLE_TLDS.has(tld)) continue;
		const suffix = tld.slice(1); // remove leading dot
		if (suffix.length < MIN_HACK_SUFFIX_LENGTH) continue;
		if (word.endsWith(suffix) && word.length > suffix.length) {
			const name = word.slice(0, word.length - suffix.length);
			if (name.length >= 2) { // min 2 chars for a valid domain name
				const score = suffix.length / word.length; // quality: longer suffix = better hack
				results.push({ name, tld, score });
			}
		}
	}
	// Sort by quality score descending (best hacks first)
	results.sort((a, b) => b.score - a.score);
	return results;
}

/** Apply a single mutation to a word */
function applyMutation(word: string, mutation: MutationType): string | null {
	switch (mutation) {
		case 'original': return word;
		case 'dropLastVowel': return dropLastVowel(word);
		case 'dropAllVowels': return dropAllVowels(word);
		case 'addR': return addR(word);
		case 'addLy': return addLy(word);
		case 'addIfy': return addIfy(word);
		case 'addDb': return addDb(word);
		case 'addHq': return addHq(word);
		case 'plural': return pluralize(word);
		case 'doubleLastLetter': return doubleLastLetter(word);
		case 'domainHack': return null; // handled separately
		case 'compound': return null; // handled separately in generateCandidates
		case 'custom': return null; // handled separately in generateCandidates
	}
}

/**
 * Generate all domain candidates from terms × mutations × TLDs.
 * Deduplicates by full domain name.
 */
export function generateCandidates(
	terms: string[],
	mutations: Set<MutationType>,
	tlds: Set<string>,
	customMutations?: CustomMutation[],
): DomainCandidate[] {
	const seen = new Set<string>();
	const candidates: DomainCandidate[] = [];
	const tldArr = [...tlds];

	// Collect cleaned terms for compound generation
	const cleanTerms: string[] = [];
	for (const rawTerm of terms) {
		const t = rawTerm.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
		if (t && t.length >= 2) cleanTerms.push(t);
	}

	// Compound mutation: ordered pairs of terms (requires 2+ terms)
	if (mutations.has('compound') && cleanTerms.length >= 2) {
		for (let i = 0; i < cleanTerms.length; i++) {
			for (let j = 0; j < cleanTerms.length; j++) {
				if (i === j) continue;
				const compound = cleanTerms[i] + cleanTerms[j];
				for (const tld of tldArr) {
					const domain = `${compound}${tld}`;
					if (seen.has(domain)) continue;
					seen.add(domain);
					candidates.push({
						domain,
						term: `${cleanTerms[i]}+${cleanTerms[j]}`,
						name: compound,
						tld,
						mutation: 'compound',
						nameLength: compound.length,
					});
				}
			}
		}
	}

	// Custom mutations: apply user-defined {term} patterns
	if (mutations.has('custom') && customMutations && customMutations.length > 0) {
		for (const term of cleanTerms) {
			for (const cm of customMutations) {
				const mutated = cm.pattern.replace(/\{term\}/g, term).replace(/[^a-z0-9-]/g, '');
				if (!mutated || mutated.length < 2) continue;
				for (const tld of tldArr) {
					const domain = `${mutated}${tld}`;
					if (seen.has(domain)) continue;
					seen.add(domain);
					candidates.push({
						domain,
						term,
						name: mutated,
						tld,
						mutation: 'custom',
						nameLength: mutated.length,
					});
				}
			}
		}
	}

	for (const rawTerm of terms) {
		const term = rawTerm.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
		if (!term || term.length < 2) continue;

		for (const mutation of mutations) {
			if (mutation === 'compound') continue; // handled above
			if (mutation === 'custom') continue; // handled above
			if (mutation === 'domainHack') {
				// Domain hack generates its own TLD pairings
				const hacks = findDomainHacks(term, tldArr);
				for (const hack of hacks) {
					const domain = `${hack.name}${hack.tld}`;
					if (seen.has(domain)) continue;
					seen.add(domain);
					candidates.push({
						domain,
						term,
						name: hack.name,
						tld: hack.tld,
						mutation: 'domainHack',
						nameLength: hack.name.length,
					});
				}
				continue;
			}

			const mutated = applyMutation(term, mutation);
			if (!mutated) continue;

			for (const tld of tldArr) {
				const domain = `${mutated}${tld}`;
				if (seen.has(domain)) continue;
				seen.add(domain);
				candidates.push({
					domain,
					term,
					name: mutated,
					tld,
					mutation,
					nameLength: mutated.length,
				});
			}
		}
	}

	return candidates;
}
