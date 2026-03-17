/**
 * Tutorial help system — session-only toggle that shows info badges on key UI features.
 * Tapping a badge opens a modal with a rich explanation of that feature.
 */

/** Compile-time union of all help topics for badge placement safety */
export type HelpTopic =
	| 'search'
	| 'mutations'
	| 'tlds'
	| 'resolver-modes'
	| 'local-api'
	| 'monitor'
	| 'pricing'
	| 'save-bookmark'
	| 'registrar-filter'
	| 'verify-button';

interface HelpEntry {
	title: string;
	body: string;
}

/** Static map of topic → rich HTML content for the help modal */
export const HELP_CONTENT: Record<HelpTopic, HelpEntry> = {
	search: {
		title: 'Search Terms',
		body: `
			<p>Enter one or more words (comma or newline separated). Each term is combined with every selected <strong>mutation</strong> and <strong>TLD</strong> to generate domain candidates.</p>
			<p>For example, 2 terms &times; 3 mutations &times; 5 TLDs = 30 candidates checked.</p>
			<ul>
				<li>Use short, brandable words for best results</li>
				<li>Multi-word terms get concatenated automatically</li>
			</ul>
			<p><kbd>Ctrl</kbd>+<kbd>Enter</kbd> starts the search from anywhere in the form.</p>
		`,
	},
	mutations: {
		title: 'Name Mutations',
		body: `
			<p>Mutations transform your base terms into creative domain name variations. Each enabled mutation produces additional candidates per term.</p>
			<ul>
				<li><strong>Original</strong> &mdash; your term as-is (<code>torch</code>)</li>
				<li><strong>Prefix/Suffix</strong> &mdash; common additions (<code>gettorch</code>, <code>torchly</code>)</li>
				<li><strong>Compound</strong> &mdash; pairs of your terms (<code>torchsift</code>)</li>
				<li><strong>Domain hack</strong> &mdash; TLD embedded in word (<code>torc.h</code>)</li>
				<li><strong>Vowel drop</strong> &mdash; consonant-only (<code>trch</code>)</li>
				<li><strong>Double</strong> &mdash; repeated term (<code>torchtorch</code>)</li>
				<li><strong>Reverse</strong> &mdash; backwards (<code>hcrot</code>)</li>
				<li><strong>Custom</strong> &mdash; your own <code>{term}</code> template</li>
			</ul>
			<p>Select <strong>all</strong> for maximum coverage, or <strong>reset</strong> to just the original term.</p>
		`,
	},
	tlds: {
		title: 'TLD Selection',
		body: `
			<p>Choose which top-level domains to check. The app includes 470+ TLDs from popular generics to country-codes.</p>
			<ul>
				<li><strong>Presets</strong> &mdash; quick-select groups (Startup, Short, Geo, etc.)</li>
				<li><strong>Search</strong> &mdash; type to filter the TLD list</li>
				<li><strong>Export/Import</strong> &mdash; copy your selection to clipboard or paste one in</li>
			</ul>
			<p>Tip: fewer TLDs = faster results. Start with popular TLDs and expand as needed.</p>
		`,
	},
	'resolver-modes': {
		title: 'Resolver Modes',
		body: `
			<p>The app checks domain availability using three different methods, in priority order:</p>
			<ol>
				<li><strong>Local API</strong> &mdash; runs <code>dig</code> + <code>whois</code> on your machine. Most accurate, no rate limits, full whois data. Requires a local server (<code>npx findurlink</code>).</li>
				<li><strong>Edge Worker</strong> &mdash; Cloudflare Worker proxy using DNS-over-HTTPS + RDAP. Good accuracy, moderate rate limits. Works without any setup.</li>
				<li><strong>Browser DoH</strong> &mdash; client-side DNS-over-HTTPS queries with RDAP verification. Fallback when nothing else is available. Some TLDs (e.g. <code>.dev</code>) may not resolve correctly.</li>
			</ol>
			<p>By default, the app <strong>auto-detects</strong> the best available mode. You can force a specific mode from the dropdown in the header.</p>
		`,
	},
	'local-api': {
		title: 'Local API Server',
		body: `
			<p>The local API server provides the most accurate domain lookups by running real <code>dig</code> and <code>whois</code> commands on your machine.</p>
			<p><strong>How to run:</strong></p>
			<pre>npx findurlink</pre>
			<p>Or with Bun:</p>
			<pre>bunx findurlink</pre>
			<p><strong>System requirements:</strong></p>
			<ul>
				<li>Node.js 18+ or Bun</li>
				<li><code>dig</code> CLI (part of <code>dnsutils</code> / <code>bind-tools</code>)</li>
				<li><code>whois</code> CLI</li>
			</ul>
			<p><strong>Why use it:</strong></p>
			<ul>
				<li>Most accurate &mdash; real DNS queries, not DoH approximations</li>
				<li>Full whois data &mdash; registrar, dates, nameservers</li>
				<li>No rate limits &mdash; check thousands of domains freely</li>
				<li>Works with all TLDs including <code>.dev</code>, <code>.app</code></li>
			</ul>
			<p>The green <strong>Local</strong> badge in the header confirms the API is connected.</p>
		`,
	},
	monitor: {
		title: 'Domain Monitor',
		body: `
			<p>The monitor watches domains for status changes (e.g. taken &rarr; available). Tap the <strong>eye icon</strong> on any domain card to add it to the watchlist.</p>
			<ul>
				<li>Set the re-check interval (1h, 6h, or 24h) in the monitor panel</li>
				<li>Domains that change status are highlighted</li>
				<li>Remove domains from the watchlist at any time</li>
			</ul>
			<p><strong>Limitation:</strong> monitoring only runs while the browser tab is open. It does not run in the background when the tab is closed.</p>
		`,
	},
	pricing: {
		title: 'Domain Pricing',
		body: `
			<p>The <strong>Reg</strong> and <strong>Ren</strong> columns show registration and annual renewal prices from Porkbun.</p>
			<ul>
				<li>Prices update periodically and are cached for 1 hour</li>
				<li>Not all TLDs have pricing data</li>
				<li>Use the <strong>Renewal price</strong> filter in the sidebar to set a budget ceiling</li>
			</ul>
			<p>Tip: sort by the Reg or Ren column to find the cheapest available domains first.</p>
		`,
	},
	'save-bookmark': {
		title: 'Saved Domains',
		body: `
			<p>Tap the <strong>star icon</strong> on any result to save it to your bookmarks. Saved domains persist in localStorage across sessions.</p>
			<ul>
				<li>Create named <strong>lists</strong> to organise your favourites</li>
				<li><strong>Export</strong> your saved domains as a JSON file</li>
				<li><strong>Import</strong> a previously exported file to restore bookmarks</li>
			</ul>
			<p>Open the star button in the header to view and manage all saved domains.</p>
		`,
	},
	'registrar-filter': {
		title: 'Registrar Filter',
		body: `
			<p>Filter results to show only TLDs available at specific registrars. Supported registrars:</p>
			<ul>
				<li><strong>Porkbun</strong> &mdash; competitive pricing, free WHOIS privacy</li>
				<li><strong>Namecheap</strong> &mdash; wide TLD support</li>
				<li><strong>Cloudflare</strong> &mdash; at-cost pricing, no markup</li>
				<li><strong>Spaceship</strong> &mdash; modern interface, good prices</li>
			</ul>
			<p>When multiple registrars are selected, only TLDs available at <strong>all</strong> selected registrars are shown.</p>
		`,
	},
	'verify-button': {
		title: 'RDAP Verification',
		body: `
			<p>Domains with a <strong>&ldquo;likely available&rdquo;</strong> status (yellow dot) haven't been fully confirmed. The <strong>verify</strong> button triggers an RDAP lookup to get a definitive answer.</p>
			<ul>
				<li>Green dot = confirmed available via WHOIS/RDAP</li>
				<li>Yellow dot = DNS says no records, but WHOIS wasn't checked</li>
				<li><strong>Stale recheck</strong> re-verifies results older than 24 hours</li>
			</ul>
			<p>In Local API mode, verification is automatic. Browser/Edge modes may need manual verification for some TLDs.</p>
		`,
	},
};

/** Reactive help state — session-only, not persisted to localStorage */
class HelpState {
	/** Whether tutorial badges are visible */
	tutorialMode = $state(false);
	/** Currently open topic (null = modal closed) */
	activeTopic = $state<HelpTopic | null>(null);

	/** Toggle tutorial mode on/off */
	toggle() {
		this.tutorialMode = !this.tutorialMode;
		if (!this.tutorialMode) this.activeTopic = null;
	}

	/** Open the modal for a specific topic */
	show(topic: HelpTopic) {
		this.activeTopic = topic;
	}

	/** Close the modal */
	close() {
		this.activeTopic = null;
	}
}

/** Singleton help state instance */
export const help = new HelpState();
