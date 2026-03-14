# digr Mutation System

## Overview

Mutations transform user search terms into creative domain name candidates. The system generates all combinations of `terms × mutations × TLDs`, deduplicating by full domain name.

**Source:** `src/lib/mutations.ts`

## Mutation Types

| Type | Label | Transform | Example |
|------|-------|-----------|---------|
| `original` | Original | No change | `torch` → `torch` |
| `dropLastVowel` | Drop vowel | Remove rightmost vowel | `torch` → `torchr`, `filter` → `filtr` |
| `dropAllVowels` | No vowels | Remove every vowel | `torch` → `trch`, `filter` → `fltr` |
| `addR` | Add -r | Append `r` (skip if ends in r) | `scope` → `scopr`, `seek` → `seekr` |
| `addLy` | Add -ly | Append `ly` (skip if ends in ly) | `torch` → `torchly` |
| `addIfy` | Add -ify | Append `ify` (skip if ends in ify) | `torch` → `torchify` |
| `addDb` | Add -db | Append `db` | `torch` → `torchdb` |
| `addHq` | Add -hq | Append `hq` | `torch` → `torchhq` |
| `plural` | Plural | English pluralization rules | `torch` → `torches`, `spec` → `specs` |
| `doubleLastLetter` | Double last | Repeat final consonant | `dig` → `digg`, `spec` → `specc` |
| `domainHack` | Domain hack | TLD forms word ending | `delicious` → `delicio.us` |
| `compound` | Compound | Combine term pairs | `torch`+`light` → `torchlight` |
| `custom` | Custom | User-defined `{term}` patterns | pattern `{term}hub` → `torchhub` |

## Pluralization Rules

1. Word ends in `s` → skip (already plural)
2. Word ends in `ch`, `sh`, `x`, `z`, `ss` → append `es`
3. Word ends in consonant+`y` → replace `y` with `ies`
4. Otherwise → append `s`

## Domain Hack Algorithm

Domain hacks use the TLD as part of the word: `del.icio.us` for "delicious".

### Curated TLD Set

Only 84 TLDs in the `HACKABLE_TLDS` set generate domain hacks. This prevents noise from the full 470+ TLD list. The set includes word-ending suffixes like `.us`, `.ly`, `.io`, `.er`, `.al`, `.art`, `.dev`, `.run`, `.live`, etc.

### Matching Process

1. For each term and each TLD in `HACKABLE_TLDS`:
   - Check if term ends with the TLD suffix (minus dot)
   - Require at least 2 characters before the suffix
   - Require suffix length ≥ 2
2. Score by `suffix.length / word.length` (longer suffix match = better hack)
3. Sort results by score descending

### Example

Term `delicious`, TLDs include `.us`, `.io`:
- `.us` → `delicio` + `.us` → score 2/9 = 0.22
- `.io` → not a suffix match

## Compound Mutation

Generates ordered pairs from multiple search terms. Requires 2+ terms.

For terms `[torch, light]` and TLD `.dev`:
- `torchlight.dev` (term: `torch+light`)
- `lighttorch.dev` (term: `light+torch`)

Each pair is directional — both orderings are generated.

## Custom Mutations

Users can define their own patterns using `{term}` as a placeholder. Patterns are stored in localStorage and applied during candidate generation.

**Pattern format:** Any string containing `{term}`, e.g.:
- `{term}hub` → `torchhub`
- `go{term}` → `gotorch`
- `{term}ai` → `torchai`

**Validation:** Pattern must contain `{term}` and produce valid domain characters (a-z, 0-9, hyphens). Minimum 2 characters after substitution.

**Files:** `CustomMutationEditor.svelte`, `app.svelte.ts:customMutations`

## Candidate Generation Algorithm

`generateCandidates(terms, mutations, tlds, customMutations?)`:

1. Clean terms: lowercase, strip non-alphanumeric, require length ≥ 2
2. **Compound pass** (if enabled, 2+ terms): all ordered term pairs × all TLDs
3. **Custom pass** (if enabled): apply each custom mutation pattern per term × TLD
4. **Standard pass** per term:
   - Skip `compound` and `custom` (already handled)
   - For `domainHack`: call `findDomainHacks()` which pairs its own TLDs
   - For others: `applyMutation(term, type)` → if non-null, combine with each TLD
4. Deduplicate by full domain name (e.g., if `original` and another mutation produce the same string)

Returns `DomainCandidate[]` with `{ domain, term, name, tld, mutation, nameLength }`.

## Adding New Mutations

1. Add type name to `MutationType` union in `src/lib/types.ts`
2. Add display metadata to `MUTATION_INFO` in `src/lib/types.ts`
3. Add case to `applyMutation()` in `src/lib/mutations.ts`
4. If the mutation needs special generation logic (like domain hacks or compounds), add a block in `generateCandidates()` and return `null` from `applyMutation()`
