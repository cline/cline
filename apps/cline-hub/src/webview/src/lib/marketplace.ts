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

export type MarketplaceEntry = {
	id: string;
	type: MarketplacePrimitiveType;
	name: string;
	featured?: boolean;
	tagline: string;
	description: string;
	tags: string[];
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

export async function fetchMarketplaceCatalog(): Promise<MarketplaceCatalog> {
	const response = await fetch(MARKETPLACE_CATALOG_URL, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch marketplace: ${response.status}`);
	}
	const data = await response.json();
	const baseUrl = typeof data?.baseUrl === "string" ? data.baseUrl : undefined;
	const rawCounts =
		typeof data?.counts === "object" && data.counts !== null ? data.counts : {};

	const tags: MarketplaceTag[] = Array.isArray(data?.tags)
		? data.tags
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

	const entries: MarketplaceEntry[] = Array.isArray(data?.entries)
		? data.entries
				.map((entry: unknown) => {
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
		version: parseCount(data?.version) || EMPTY_CATALOG.version,
		generatedAt:
			typeof data?.generatedAt === "string" ? data.generatedAt : undefined,
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
