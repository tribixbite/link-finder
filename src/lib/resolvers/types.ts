import type { DomainStatus, DomainMethod, ResolverMode, WhoisData } from '../types';

/** Result from a resolver check */
export interface ResolverResult {
	domain: string;
	status: DomainStatus;
	records: string[];
	error?: string;
	method: DomainMethod;
}

/** Callback for streaming results */
export type OnResult = (result: ResolverResult) => void;

/** Resolver interface — all three modes implement this */
export interface Resolver {
	/** Check availability for a batch of domains, calling onResult as they complete */
	check(domains: string[], onResult: OnResult, signal?: AbortSignal): Promise<void>;

	/** Get detailed registration data for a single domain (whois/RDAP) */
	lookup(domain: string): Promise<WhoisData | null>;

	/** Verify a likely-available domain via RDAP (browser mode only, no-op for others) */
	verify(domain: string): Promise<ResolverResult>;

	/** The active mode */
	readonly mode: ResolverMode;
}

/** DoH provider configuration */
export interface DohProvider {
	name: string;
	url: (domain: string) => string;
	headers?: Record<string, string>;
}

/** DoH JSON response shape (Google/Cloudflare/Quad9) */
export interface DohResponse {
	Status: number; // 0=NOERROR, 2=SERVFAIL, 3=NXDOMAIN
	Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
	Authority?: Array<{ name: string; type: number; TTL: number; data: string }>;
}

/** RDAP domain response (subset of fields we use) */
export interface RdapResponse {
	handle?: string;
	ldhName?: string;
	status?: string[];
	entities?: Array<{
		roles?: string[];
		vcardArray?: unknown[];
		publicIds?: Array<{ type: string; identifier: string }>;
	}>;
	events?: Array<{ eventAction: string; eventDate: string }>;
	nameservers?: Array<{ ldhName: string }>;
}
