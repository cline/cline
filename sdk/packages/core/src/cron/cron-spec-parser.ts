import { createHash } from "node:crypto";
import type {
	CronEventSpec,
	CronOneOffSpec,
	CronScheduleSpec,
	CronSpec,
	CronSpecExtensionKind,
	CronSpecMode,
	CronSpecParseResult,
	CronTriggerKind,
} from "@clinebot/shared";
import YAML from "yaml";
import { ALL_DEFAULT_TOOL_NAMES } from "../extensions/tools/constants";
import { validateCronSchedule } from "./scheduler";

/**
 * Markdown frontmatter parser for `.cline/cron/*.md` automation specs.
 *
 * Lives in @clinebot/core because it depends on `yaml`. The spec types
 * themselves live in @clinebot/shared so other packages can consume them
 * without pulling in a YAML parser.
 *
 * The parser never throws for a single bad file — it produces a
 * `CronSpecParseResult` with an `error` message so the reconciler can record
 * `parse_status='invalid'` durably instead of dropping state.
 */

export function inferTriggerKindFromPath(
	relativePath: string,
): CronTriggerKind {
	const normalized = relativePath.replace(/\\/g, "/");
	if (normalized.startsWith("events/") && normalized.endsWith(".event.md")) {
		return "event";
	}
	if (normalized.endsWith(".cron.md")) {
		return "schedule";
	}
	return "one_off";
}

export function splitFrontmatter(raw: string): {
	frontmatter: string | undefined;
	body: string;
} {
	const text = raw.replace(/\r\n/g, "\n");
	if (!text.startsWith("---\n")) {
		return { frontmatter: undefined, body: raw };
	}
	const afterOpen = text.slice(4);
	const closeIdx = afterOpen.indexOf("\n---");
	if (closeIdx === -1) {
		return { frontmatter: undefined, body: raw };
	}
	const frontmatter = afterOpen.slice(0, closeIdx);
	let rest = afterOpen.slice(closeIdx + 4);
	if (rest.startsWith("\n")) rest = rest.slice(1);
	return { frontmatter, body: rest };
}

function trimOrUndefined(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTags(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const tags = value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter((item) => item.length > 0);
	return tags.length > 0 ? tags : undefined;
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

function normalizeModelSelection(
	value: unknown,
): { providerId?: string; modelId?: string } | undefined {
	const obj = normalizeRecord(value);
	if (!obj) return undefined;
	const providerId = trimOrUndefined(obj.providerId);
	const modelId = trimOrUndefined(obj.modelId);
	if (providerId === undefined && modelId === undefined) return undefined;
	return { providerId, modelId };
}

function normalizeMode(value: unknown): CronSpecMode | undefined {
	if (typeof value !== "string") return undefined;
	const lower = value.trim().toLowerCase();
	if (lower === "act" || lower === "plan" || lower === "yolo") return lower;
	return undefined;
}

function normalizeStringList(
	value: unknown,
	options: { preserveEmptyArray?: boolean } = {},
): string[] | undefined {
	const raw = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(",")
			: undefined;
	if (!raw) return undefined;
	const normalized = [
		...new Set(
			raw
				.map((item) => (typeof item === "string" ? item.trim() : ""))
				.filter((item) => item.length > 0),
		),
	];
	if (Array.isArray(value) && options.preserveEmptyArray) {
		return normalized;
	}
	return normalized.length > 0 ? normalized : undefined;
}

const DEFAULT_TOOL_NAME_SET = new Set<string>(ALL_DEFAULT_TOOL_NAMES);

function normalizeToolList(value: unknown): string[] | undefined {
	const tools = normalizeStringList(value, { preserveEmptyArray: true });
	if (!tools) return undefined;
	const invalid = tools.filter((tool) => !DEFAULT_TOOL_NAME_SET.has(tool));
	if (invalid.length > 0) {
		throw new Error(`unknown tool(s): ${invalid.join(", ")}`);
	}
	return tools;
}

const CRON_EXTENSION_KINDS = new Set<CronSpecExtensionKind>([
	"rules",
	"skills",
	"plugins",
]);

function normalizeExtensions(
	value: unknown,
): CronSpecExtensionKind[] | undefined {
	const extensions = normalizeStringList(value, { preserveEmptyArray: true });
	if (!extensions) return undefined;
	const invalid = extensions.filter(
		(extension) =>
			!CRON_EXTENSION_KINDS.has(extension as CronSpecExtensionKind),
	);
	if (invalid.length > 0) {
		throw new Error(`unknown extension(s): ${invalid.join(", ")}`);
	}
	return extensions as CronSpecExtensionKind[];
}

function asPositiveInt(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.floor(value);
}

function asNonNegativeInt(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	return Math.floor(value);
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value ?? null);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>).filter(
		([, v]) => v !== undefined,
	);
	entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries
		.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
		.join(",")}}`;
}

export function computeContentHash(
	frontmatterJson: unknown,
	body: string,
): string {
	const hash = createHash("sha256");
	hash.update(stableStringify(frontmatterJson));
	hash.update("\n");
	hash.update(body);
	return hash.digest("hex");
}

function filenameStem(relativePath: string): string {
	const base = relativePath.split("/").pop() ?? relativePath;
	return base
		.replace(/\.event\.md$/, "")
		.replace(/\.cron\.md$/, "")
		.replace(/\.md$/, "");
}

const SCHEDULE_ONLY_FIELDS = ["schedule", "timezone"] as const;
const EVENT_ONLY_FIELDS = [
	"event",
	"filters",
	"debounceSeconds",
	"dedupeWindowSeconds",
	"cooldownSeconds",
	"maxParallel",
] as const;
const REMOVED_FIELDS = ["cwd"] as const;

export interface ParseCronSpecInput {
	relativePath: string;
	raw: string;
}

function invalid(
	relativePath: string,
	triggerKind: CronTriggerKind,
	body: string,
	frontmatter: Record<string, unknown>,
	error: string,
): CronSpecParseResult {
	return {
		externalId: relativePath,
		relativePath,
		triggerKind,
		body,
		contentHash: computeContentHash(frontmatter, body),
		error,
	};
}

function invalidWithHash(
	externalId: string,
	relativePath: string,
	triggerKind: CronTriggerKind,
	body: string,
	contentHash: string,
	error: string,
): CronSpecParseResult {
	return {
		externalId,
		relativePath,
		triggerKind,
		body,
		contentHash,
		error,
	};
}

/**
 * Parse a single cron spec file. Never throws; always returns a result.
 */
export function parseCronSpecFile(
	input: ParseCronSpecInput,
): CronSpecParseResult {
	const relativePath = input.relativePath.replace(/\\/g, "/");
	const triggerKind = inferTriggerKindFromPath(relativePath);
	const { frontmatter, body } = splitFrontmatter(input.raw);

	let frontmatterData: Record<string, unknown> = {};
	if (frontmatter !== undefined && frontmatter.trim().length > 0) {
		try {
			const parsed = YAML.parse(frontmatter) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				frontmatterData = parsed as Record<string, unknown>;
			} else if (parsed !== null && parsed !== undefined) {
				return invalid(
					relativePath,
					triggerKind,
					body,
					{},
					"frontmatter must be a YAML mapping",
				);
			}
		} catch (err) {
			return invalid(
				relativePath,
				triggerKind,
				body,
				{},
				err instanceof Error
					? `failed to parse frontmatter: ${err.message}`
					: "failed to parse frontmatter",
			);
		}
	}

	const contentHash = computeContentHash(frontmatterData, body);
	const externalIdRaw = trimOrUndefined(frontmatterData.id);
	const externalId = externalIdRaw ?? relativePath;

	if (triggerKind !== "schedule") {
		for (const key of SCHEDULE_ONLY_FIELDS) {
			if (frontmatterData[key] !== undefined) {
				return invalidWithHash(
					externalId,
					relativePath,
					triggerKind,
					body,
					contentHash,
					`field "${key}" is only allowed on *.cron.md specs`,
				);
			}
		}
	}
	for (const key of REMOVED_FIELDS) {
		if (frontmatterData[key] !== undefined) {
			return invalidWithHash(
				externalId,
				relativePath,
				triggerKind,
				body,
				contentHash,
				`field "${key}" is no longer supported; cron specs use workspaceRoot as cwd`,
			);
		}
	}
	if (triggerKind !== "event") {
		for (const key of EVENT_ONLY_FIELDS) {
			if (frontmatterData[key] !== undefined) {
				return invalidWithHash(
					externalId,
					relativePath,
					triggerKind,
					body,
					contentHash,
					`field "${key}" is only allowed on .event.md specs`,
				);
			}
		}
	}

	const frontmatterPrompt = trimOrUndefined(frontmatterData.prompt);
	const bodyTrimmed = body.trim();
	const prompt =
		frontmatterPrompt ?? (bodyTrimmed.length > 0 ? bodyTrimmed : undefined);
	if (!prompt) {
		return invalidWithHash(
			externalId,
			relativePath,
			triggerKind,
			body,
			contentHash,
			"prompt is required (frontmatter `prompt` or markdown body)",
		);
	}

	const workspaceRoot = trimOrUndefined(frontmatterData.workspaceRoot);
	if (!workspaceRoot) {
		return invalidWithHash(
			externalId,
			relativePath,
			triggerKind,
			body,
			contentHash,
			"workspaceRoot is required",
		);
	}

	let tools: string[] | undefined;
	let extensions: CronSpecExtensionKind[] | undefined;
	try {
		tools = normalizeToolList(frontmatterData.tools);
		extensions = normalizeExtensions(frontmatterData.extensions);
	} catch (err) {
		return invalidWithHash(
			externalId,
			relativePath,
			triggerKind,
			body,
			contentHash,
			err instanceof Error ? err.message : String(err),
		);
	}

	const mode = normalizeMode(frontmatterData.mode);
	if (frontmatterData.mode !== undefined && mode === undefined) {
		return invalidWithHash(
			externalId,
			relativePath,
			triggerKind,
			body,
			contentHash,
			"mode must be one of: act, plan, yolo",
		);
	}

	const common = {
		id: externalIdRaw,
		title:
			trimOrUndefined(frontmatterData.title) ??
			externalIdRaw ??
			filenameStem(relativePath),
		prompt,
		workspaceRoot,
		mode: mode ?? "yolo",
		systemPrompt: trimOrUndefined(frontmatterData.systemPrompt),
		modelSelection: normalizeModelSelection(frontmatterData.modelSelection),
		maxIterations: asPositiveInt(frontmatterData.maxIterations),
		timeoutSeconds: asPositiveInt(frontmatterData.timeoutSeconds),
		tools,
		notesDirectory: trimOrUndefined(frontmatterData.notesDirectory),
		extensions,
		source: trimOrUndefined(frontmatterData.source) ?? "user",
		tags: normalizeTags(frontmatterData.tags),
		enabled:
			typeof frontmatterData.enabled === "boolean"
				? frontmatterData.enabled
				: true,
		metadata: normalizeRecord(frontmatterData.metadata),
	};

	let spec: CronSpec;
	if (triggerKind === "schedule") {
		const schedule = trimOrUndefined(frontmatterData.schedule);
		if (!schedule) {
			return invalidWithHash(
				externalId,
				relativePath,
				triggerKind,
				body,
				contentHash,
				"schedule is required for *.cron.md specs",
			);
		}
		const timezone = trimOrUndefined(frontmatterData.timezone);
		try {
			validateCronSchedule(schedule, timezone);
		} catch (err) {
			return invalidWithHash(
				externalId,
				relativePath,
				triggerKind,
				body,
				contentHash,
				err instanceof Error ? err.message : String(err),
			);
		}
		const s: CronScheduleSpec = {
			...common,
			triggerKind: "schedule",
			schedule,
			timezone,
		};
		spec = s;
	} else if (triggerKind === "event") {
		const event = trimOrUndefined(frontmatterData.event);
		if (!event) {
			return invalidWithHash(
				externalId,
				relativePath,
				triggerKind,
				body,
				contentHash,
				"event is required for .event.md specs",
			);
		}
		const e: CronEventSpec = {
			...common,
			triggerKind: "event",
			event,
			filters: normalizeRecord(frontmatterData.filters),
			debounceSeconds: asNonNegativeInt(frontmatterData.debounceSeconds),
			dedupeWindowSeconds: asNonNegativeInt(
				frontmatterData.dedupeWindowSeconds,
			),
			cooldownSeconds: asNonNegativeInt(frontmatterData.cooldownSeconds),
			maxParallel: asPositiveInt(frontmatterData.maxParallel),
		};
		spec = e;
	} else {
		const o: CronOneOffSpec = { ...common, triggerKind: "one_off" };
		spec = o;
	}

	return {
		externalId,
		relativePath,
		triggerKind,
		body,
		contentHash,
		spec,
	};
}
