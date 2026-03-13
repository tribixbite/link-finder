import type { DomainCandidate, MutationType } from './types';

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

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
 * Returns array of [name, tld] pairs.
 */
export function findDomainHacks(word: string, tlds: string[]): Array<{ name: string; tld: string }> {
	const results: Array<{ name: string; tld: string }> = [];
	for (const tld of tlds) {
		const suffix = tld.slice(1); // remove leading dot
		if (word.endsWith(suffix) && word.length > suffix.length) {
			const name = word.slice(0, word.length - suffix.length);
			if (name.length >= 1) {
				results.push({ name, tld });
			}
		}
	}
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
	}
}

/**
 * Generate all domain candidates from terms × mutations × TLDs.
 * Deduplicates by full domain name.
 */
export function generateCandidates(
	terms: string[],
	mutations: Set<MutationType>,
	tlds: Set<string>
): DomainCandidate[] {
	const seen = new Set<string>();
	const candidates: DomainCandidate[] = [];
	const tldArr = [...tlds];

	for (const rawTerm of terms) {
		const term = rawTerm.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
		if (!term || term.length < 2) continue;

		for (const mutation of mutations) {
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
