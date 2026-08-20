/**
 * Agent Plugins manifest (`plugin.json`) validation (Gateway RFC, Phase 4).
 *
 * Implements the manifest rules of the Agent Plugins specification
 * (https://agent-plugins.org/client-implementers/loading-and-discovery):
 *
 * - The manifest is loaded and validated before any component discovery.
 * - `$schema` selects the locally bundled validation contract; a missing
 *   or unsupported `$schema` rejects the plugin. Schemas are never
 *   fetched at load time.
 * - `name` is required and constrained (1-64 chars, lowercase ASCII
 *   letters/digits/hyphens/periods, alphanumeric at both ends, no `--`
 *   or `..`).
 * - The schema is closed, with two non-fatal violations: unknown
 *   top-level fields are reported and ignored, and a non-object
 *   `extensions` field is reported and ignored.
 * - `extensions` members are keyed by reverse-domain namespace; the
 *   Gateway ignores namespaces it does not implement without validating
 *   their values.
 */

export const AGENT_PLUGIN_SCHEMA_1_0_0 =
	"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

/**
 * `$schema` values with a bundled local rule set. Selecting rules happens
 * here, from this table — never by retrieving the schema document.
 */
export const SUPPORTED_PLUGIN_SCHEMAS: readonly string[] = [
	AGENT_PLUGIN_SCHEMA_1_0_0,
];

/** Extension namespaces this client implements. Everything else is ignored. */
export const SUPPORTED_EXTENSION_NAMESPACES: readonly string[] = [];

export const PLUGIN_NAME_PATTERN =
	/^[a-z0-9][a-z0-9.-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

export function isValidPluginName(name: string): boolean {
	return (
		PLUGIN_NAME_PATTERN.test(name) &&
		!name.includes("--") &&
		!name.includes("..")
	);
}

export interface PluginAuthor {
	readonly name?: string;
	readonly email?: string;
	readonly url?: string;
}

export interface AgentPluginManifest {
	readonly $schema: string;
	readonly name: string;
	readonly version?: string;
	readonly description?: string;
	readonly author?: PluginAuthor;
	readonly homepage?: string;
	readonly repository?: string;
	readonly license?: string;
	readonly keywords?: readonly string[];
	/** Client-owned data keyed by reverse-domain namespace. */
	readonly extensions?: Readonly<Record<string, unknown>>;
}

export type PluginDiagnosticSeverity = "info" | "warning" | "error";

export interface PluginDiagnostic {
	readonly severity: PluginDiagnosticSeverity;
	/** Stable machine code, e.g. `manifest.unknown_field`. */
	readonly code: string;
	readonly message: string;
	/** The narrowest affected boundary: plugin, component type, or entry. */
	readonly boundary:
		| "plugin"
		| "skills"
		| "mcp"
		| `skill:${string}`
		| `mcp-server:${string}`;
}

export type ManifestValidation =
	| {
			ok: true;
			manifest: AgentPluginManifest;
			diagnostics: readonly PluginDiagnostic[];
	  }
	| { ok: false; diagnostics: readonly PluginDiagnostic[] };

const PORTABLE_FIELDS = new Set([
	"$schema",
	"name",
	"version",
	"description",
	"author",
	"homepage",
	"repository",
	"license",
	"keywords",
	"extensions",
]);

function fatal(code: string, message: string): ManifestValidation {
	return {
		ok: false,
		diagnostics: [{ severity: "error", code, message, boundary: "plugin" }],
	};
}

function isStringOrUndefined(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

/**
 * Validate a parsed `plugin.json` document. Metadata strings are not
 * rejected for failing URL/email/semver/SPDX syntax — only their JSON
 * types are mandatory.
 */
export function validatePluginManifest(value: unknown): ManifestValidation {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return fatal("manifest.not_object", "plugin.json must be a JSON object");
	}
	const raw = value as Record<string, unknown>;
	const diagnostics: PluginDiagnostic[] = [];

	// $schema selects the complete validation contract.
	if (typeof raw.$schema !== "string") {
		return fatal(
			"manifest.schema_missing",
			"plugin.json requires a string `$schema` selecting the Agent Plugins version",
		);
	}
	if (!SUPPORTED_PLUGIN_SCHEMAS.includes(raw.$schema)) {
		return fatal(
			"manifest.schema_unsupported",
			`Unsupported $schema "${raw.$schema}"; supported: ${SUPPORTED_PLUGIN_SCHEMAS.join(", ")}`,
		);
	}

	if (typeof raw.name !== "string") {
		return fatal(
			"manifest.name_missing",
			"plugin.json requires a string `name`",
		);
	}
	if (!isValidPluginName(raw.name)) {
		return fatal(
			"manifest.name_invalid",
			`Invalid plugin name "${raw.name}": 1-64 lowercase letters/digits/hyphens/periods, ` +
				"alphanumeric at both ends, no `--` or `..`",
		);
	}

	// Unknown top-level fields: report and ignore (non-fatal).
	for (const key of Object.keys(raw)) {
		if (!PORTABLE_FIELDS.has(key)) {
			diagnostics.push({
				severity: "warning",
				code: "manifest.unknown_field",
				message: `Unknown top-level field "${key}" reported and ignored`,
				boundary: "plugin",
			});
		}
	}

	// Known optional fields: JSON types are mandatory (fatal on mismatch).
	for (const field of [
		"version",
		"description",
		"homepage",
		"repository",
		"license",
	] as const) {
		if (!isStringOrUndefined(raw[field])) {
			return fatal(
				"manifest.field_type",
				`Manifest field "${field}" must be a string when present`,
			);
		}
	}
	let author: PluginAuthor | undefined;
	if (raw.author !== undefined) {
		if (
			typeof raw.author !== "object" ||
			raw.author === null ||
			Array.isArray(raw.author)
		) {
			return fatal(
				"manifest.field_type",
				'Manifest field "author" must be an object when present',
			);
		}
		const candidate = raw.author as Record<string, unknown>;
		if (
			!isStringOrUndefined(candidate.name) ||
			!isStringOrUndefined(candidate.email) ||
			!isStringOrUndefined(candidate.url)
		) {
			return fatal(
				"manifest.field_type",
				'Manifest "author" members name/email/url must be strings when present',
			);
		}
		author = candidate as PluginAuthor;
	}
	let keywords: readonly string[] | undefined;
	if (raw.keywords !== undefined) {
		if (
			!Array.isArray(raw.keywords) ||
			!raw.keywords.every((entry) => typeof entry === "string")
		) {
			return fatal(
				"manifest.field_type",
				'Manifest field "keywords" must be an array of strings when present',
			);
		}
		keywords = raw.keywords as string[];
	}

	// Non-object `extensions`: report and ignore, continue with components.
	let extensions: Readonly<Record<string, unknown>> | undefined;
	if (raw.extensions !== undefined) {
		if (
			typeof raw.extensions !== "object" ||
			raw.extensions === null ||
			Array.isArray(raw.extensions)
		) {
			diagnostics.push({
				severity: "warning",
				code: "manifest.extensions_not_object",
				message:
					"Non-object `extensions` field reported and ignored; components load anyway",
				boundary: "plugin",
			});
		} else {
			extensions = raw.extensions as Record<string, unknown>;
			for (const namespace of Object.keys(extensions)) {
				if (!SUPPORTED_EXTENSION_NAMESPACES.includes(namespace)) {
					diagnostics.push({
						severity: "info",
						code: "manifest.extension_namespace_ignored",
						message: `Extension namespace "${namespace}" is not implemented by this client and is ignored without validation`,
						boundary: "plugin",
					});
				}
			}
		}
	}

	return {
		ok: true,
		manifest: {
			$schema: raw.$schema,
			name: raw.name,
			...(typeof raw.version === "string" ? { version: raw.version } : {}),
			...(typeof raw.description === "string"
				? { description: raw.description }
				: {}),
			...(author ? { author } : {}),
			...(typeof raw.homepage === "string" ? { homepage: raw.homepage } : {}),
			...(typeof raw.repository === "string"
				? { repository: raw.repository }
				: {}),
			...(typeof raw.license === "string" ? { license: raw.license } : {}),
			...(keywords ? { keywords } : {}),
			...(extensions ? { extensions } : {}),
		},
		diagnostics,
	};
}
