"use client";

import { resolveDesktopBackendHttpEndpoint } from "@/lib/desktop-client";

export type MarketplacePrimitiveType = "mcp" | "skill" | "plugin";

export type MarketplaceTag = {
	id: string;
	label: string;
	count: number;
};

export type MarketplaceEnvVar = {
	name: string;
	required?: boolean;
	description?: string;
	url?: string;
};

export type MarketplaceAuthor = {
	name: string;
	url?: string;
};

export type MarketplaceEntry = {
	id: string;
	type: MarketplacePrimitiveType;
	name: string;
	featured?: boolean;
	tagline: string;
	description: string;
	tags: string[];
	author?: MarketplaceAuthor;
	homepage?: string;
	repo?: string;
	icon?: string;
	license?: string;
	verified?: boolean;
	install: {
		args: string[];
		env?: MarketplaceEnvVar[];
		notes?: string;
		command: string;
	};
};

export type MarketplaceCatalog = {
	version: number;
	generatedAt?: string;
	baseUrl?: string;
	counts: {
		total: number;
		plugins: number;
		skills: number;
		mcps: number;
	};
	tags: MarketplaceTag[];
	entries: MarketplaceEntry[];
};

const MARKETPLACE_CATALOG_URL = "/api/marketplace/catalog";

const EMPTY_CATALOG: MarketplaceCatalog = {
	version: 1,
	counts: {
		total: 0,
		plugins: 0,
		skills: 0,
		mcps: 0,
	},
	tags: [],
	entries: [],
};

function isPrimitiveType(value: unknown): value is MarketplacePrimitiveType {
	return value === "mcp" || value === "skill" || value === "plugin";
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function parseCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseEnv(value: unknown): MarketplaceEnvVar[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const env = value
		.map((item): MarketplaceEnvVar | null => {
			if (!item || typeof item !== "object") return null;
			const candidate = item as Record<string, unknown>;
			if (typeof candidate.name !== "string") return null;
			const parsed: MarketplaceEnvVar = {
				name: candidate.name,
			};
			if (typeof candidate.required === "boolean") {
				parsed.required = candidate.required;
			}
			if (typeof candidate.description === "string") {
				parsed.description = candidate.description;
			}
			if (typeof candidate.url === "string") {
				parsed.url = candidate.url;
			}
			return parsed;
		})
		.filter((item): item is MarketplaceEnvVar => item !== null);
	return env.length > 0 ? env : undefined;
}

function parseAuthor(value: unknown): MarketplaceAuthor | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.name !== "string") return undefined;
	return {
		name: candidate.name,
		url: typeof candidate.url === "string" ? candidate.url : undefined,
	};
}

function parseOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

const CATALOG_CACHE_TTL_MS = 5 * 60_000;
let catalogCache: { value: MarketplaceCatalog; fetchedAt: number } | null =
	null;
let catalogRequest: Promise<MarketplaceCatalog> | null = null;

export function getCachedMarketplaceCatalog(): MarketplaceCatalog | null {
	return catalogCache?.value ?? null;
}

export function fetchMarketplaceCatalog(): Promise<MarketplaceCatalog> {
	if (catalogRequest) return catalogRequest;
	if (
		catalogCache &&
		Date.now() - catalogCache.fetchedAt < CATALOG_CACHE_TTL_MS
	) {
		return Promise.resolve(catalogCache.value);
	}
	const request = loadMarketplaceCatalog()
		.then((value) => {
			catalogCache = { value, fetchedAt: Date.now() };
			return value;
		})
		.finally(() => {
			if (catalogRequest === request) catalogRequest = null;
		});
	catalogRequest = request;
	return request;
}

async function loadMarketplaceCatalog(): Promise<MarketplaceCatalog> {
	const urls = [MARKETPLACE_CATALOG_URL];
	try {
		const backendEndpoint = await resolveDesktopBackendHttpEndpoint();
		urls.unshift(new URL(MARKETPLACE_CATALOG_URL, `${backendEndpoint}/`).href);
	} catch {
		// Fall back to the statically exported route when the sidecar is unavailable.
	}

	let data: unknown;
	let lastError: unknown;
	for (const url of urls) {
		try {
			const response = await fetch(url, {
				headers: { Accept: "application/json" },
			});
			if (!response.ok) {
				throw new Error(`Failed to fetch marketplace: ${response.status}`);
			}
			data = await response.json();
			break;
		} catch (error) {
			lastError = error;
		}
	}

	if (data === undefined) {
		throw lastError instanceof Error
			? lastError
			: new Error("Failed to fetch marketplace");
	}
	const payload: Record<string, unknown> =
		data && typeof data === "object" ? (data as Record<string, unknown>) : {};
	// The sidecar returns an empty fallback with an error when its upstream
	// fails. Do not retain that fallback as a successful catalog for the TTL.
	if (typeof payload.error === "string") throw new Error(payload.error);

	const baseUrl =
		typeof payload.baseUrl === "string" ? payload.baseUrl : undefined;
	const rawCounts: Record<string, unknown> =
		typeof payload.counts === "object" && payload.counts !== null
			? (payload.counts as Record<string, unknown>)
			: {};

	const tags: MarketplaceTag[] = Array.isArray(payload.tags)
		? payload.tags
				.map((tag: unknown) => {
					if (!tag || typeof tag !== "object") return null;
					const candidate = tag as Record<string, unknown>;
					if (
						typeof candidate.id !== "string" ||
						typeof candidate.label !== "string"
					) {
						return null;
					}
					return {
						id: candidate.id,
						label: candidate.label,
						count: parseCount(candidate.count),
					};
				})
				.filter(
					(tag: MarketplaceTag | null): tag is MarketplaceTag => tag !== null,
				)
		: [];

	const entries: MarketplaceEntry[] = Array.isArray(payload.entries)
		? payload.entries
				.map((entry: unknown): MarketplaceEntry | null => {
					if (!entry || typeof entry !== "object") return null;
					const candidate = entry as Record<string, unknown>;
					const install =
						typeof candidate.install === "object" && candidate.install !== null
							? (candidate.install as Record<string, unknown>)
							: {};
					if (
						typeof candidate.id !== "string" ||
						!isPrimitiveType(candidate.type) ||
						typeof candidate.name !== "string" ||
						typeof candidate.tagline !== "string" ||
						typeof candidate.description !== "string" ||
						typeof install.command !== "string"
					) {
						return null;
					}
					return {
						id: candidate.id,
						type: candidate.type,
						name: candidate.name,
						featured:
							typeof candidate.featured === "boolean"
								? candidate.featured
								: undefined,
						tagline: candidate.tagline,
						description: candidate.description,
						tags: toStringArray(candidate.tags),
						author: parseAuthor(candidate.author),
						homepage: parseOptionalString(candidate.homepage),
						repo: parseOptionalString(candidate.repo),
						icon: parseOptionalString(candidate.icon),
						license: parseOptionalString(candidate.license),
						verified:
							typeof candidate.verified === "boolean"
								? candidate.verified
								: undefined,
						install: {
							args: toStringArray(install.args),
							command: install.command,
							env: parseEnv(install.env),
							notes:
								typeof install.notes === "string" ? install.notes : undefined,
						},
					};
				})
				.filter(
					(entry: MarketplaceEntry | null): entry is MarketplaceEntry =>
						entry !== null && entry.install.args.length > 0,
				)
		: [];

	return {
		version: parseCount(payload.version) || EMPTY_CATALOG.version,
		generatedAt:
			typeof payload.generatedAt === "string" ? payload.generatedAt : undefined,
		baseUrl,
		counts: {
			total: parseCount(rawCounts.total) || entries.length,
			plugins: parseCount(rawCounts.plugins),
			skills: parseCount(rawCounts.skills),
			mcps: parseCount(rawCounts.mcps),
		},
		tags,
		entries,
	};
}

export { EMPTY_CATALOG, MARKETPLACE_CATALOG_URL };
