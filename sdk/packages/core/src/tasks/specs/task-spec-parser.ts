import { createHash } from "node:crypto";
import type {
	AgendaTaskActor,
	AgendaTaskCreateInput,
	AgendaTaskPriority,
	AgendaTaskScope,
	AgendaTaskType,
	GatewayModelSelection,
} from "@cline/shared";
import YAML from "yaml";
import { normalizeAgendaTaskLocation } from "../task-location";

const TASK_TYPES = new Set<AgendaTaskType>([
	"suggestion",
	"follow-up",
	"todo",
	"handoff",
	"idea",
	"reminder",
]);

const RESERVED_FIELDS = new Set([
	"status",
	"instructions",
	"revision",
	"approvedRevision",
	"createdBy",
	"updatedBy",
	"currentRunId",
	"lastRunId",
	"lastSessionId",
	"error",
	"createdAt",
	"updatedAt",
	"completedAt",
	"archivedAt",
]);

const ALLOWED_FIELDS = new Set([
	"taskId",
	"type",
	"priority",
	"title",
	"description",
	"availableAt",
	"expiresAt",
	"cwd",
	"resourcePaths",
	"assignee",
	"modelSelection",
	"mode",
	"systemPrompt",
	"maxIterations",
	"timeoutSeconds",
	"automationEligible",
]);

export interface AgendaTaskSpec {
	taskId?: string;
	type: AgendaTaskType;
	title: string;
	description?: string;
	instructions: string;
	scope: AgendaTaskScope;
	workspaceRoot?: string;
	cwd?: string;
	resourcePaths: string[];
	priority: AgendaTaskPriority;
	assignee?: string;
	modelSelection?: GatewayModelSelection;
	mode?: "act" | "plan" | "yolo";
	systemPrompt?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	availableAt?: string;
	expiresAt: string;
	automationEligible: boolean;
	specPath: string;
	contentHash: string;
}

export interface ParseAgendaTaskSpecInput {
	specPath: string;
	raw: string;
	scope: AgendaTaskScope;
	workspaceRoot?: string;
}

export type AgendaTaskSpecParseResult =
	| {
			ok: true;
			specPath: string;
			contentHash: string;
			spec: AgendaTaskSpec;
	  }
	| {
			ok: false;
			specPath: string;
			contentHash: string;
			error: string;
	  };

export interface AgendaTaskSpecWriteInput {
	taskId: string;
	type: AgendaTaskType;
	title: string;
	description?: string;
	instructions: string;
	cwd?: string;
	resourcePaths?: string[];
	priority?: AgendaTaskPriority;
	assignee?: string;
	modelSelection?: GatewayModelSelection;
	mode?: "act" | "plan" | "yolo";
	systemPrompt?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	availableAt?: string;
	expiresAt: string;
	automationEligible?: boolean;
}

function splitFrontmatter(raw: string): {
	frontmatter?: string;
	body: string;
} {
	const normalized = raw.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) {
		return { body: normalized };
	}
	const afterOpen = normalized.slice(4);
	const closeIndex = afterOpen.indexOf("\n---");
	if (closeIndex === -1) {
		return { body: normalized };
	}
	let body = afterOpen.slice(closeIndex + 4);
	if (body.startsWith("\n")) body = body.slice(1);
	return {
		frontmatter: afterOpen.slice(0, closeIndex),
		body,
	};
}

function hashContent(frontmatter: unknown, body: string): string {
	return createHash("sha256")
		.update(JSON.stringify(frontmatter))
		.update("\n")
		.update(body.trim())
		.digest("hex");
}

function asNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function parseIsoTimestamp(value: unknown, field: string): string | Error {
	const text = asNonEmptyString(value);
	if (!text || !Number.isFinite(Date.parse(text))) {
		return new Error(`${field} must be a valid ISO-8601 timestamp`);
	}
	return new Date(text).toISOString();
}

function parsePositiveInteger(
	value: unknown,
	field: string,
): number | undefined | Error {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || (value as number) <= 0) {
		return new Error(`${field} must be a positive integer`);
	}
	return value as number;
}

function parseStringList(value: unknown, field: string): string[] | Error {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		return new Error(`${field} must be an array of strings`);
	}
	const result: string[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		const normalized = asNonEmptyString(entry);
		if (!normalized) {
			return new Error(`${field} must contain only non-empty strings`);
		}
		if (!seen.has(normalized)) {
			seen.add(normalized);
			result.push(normalized);
		}
	}
	return result;
}

function parseModelSelection(
	value: unknown,
): GatewayModelSelection | undefined | Error {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return new Error("modelSelection must be a mapping");
	}
	const record = value as Record<string, unknown>;
	const unknownKeys = Object.keys(record).filter(
		(key) => key !== "providerId" && key !== "modelId",
	);
	if (unknownKeys.length > 0) {
		return new Error(
			`modelSelection contains unknown field(s): ${unknownKeys.join(", ")}`,
		);
	}
	const providerId = asNonEmptyString(record.providerId);
	if (!providerId) {
		return new Error("modelSelection.providerId is required");
	}
	const modelId = asNonEmptyString(record.modelId);
	return { providerId, ...(modelId ? { modelId } : {}) };
}

function invalid(
	input: ParseAgendaTaskSpecInput,
	contentHash: string,
	error: string,
): AgendaTaskSpecParseResult {
	return {
		ok: false,
		specPath: input.specPath,
		contentHash,
		error,
	};
}

/** Parse one task Markdown file without throwing for invalid user content. */
export function parseAgendaTaskSpec(
	input: ParseAgendaTaskSpecInput,
): AgendaTaskSpecParseResult {
	const { frontmatter, body } = splitFrontmatter(input.raw);
	if (frontmatter === undefined) {
		return invalid(
			input,
			hashContent({}, body),
			"task spec must begin with YAML frontmatter",
		);
	}

	let data: Record<string, unknown>;
	try {
		const parsed = YAML.parse(frontmatter) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return invalid(
				input,
				hashContent({}, body),
				"frontmatter must be a YAML mapping",
			);
		}
		data = parsed as Record<string, unknown>;
	} catch (error) {
		return invalid(
			input,
			hashContent({}, body),
			error instanceof Error
				? `failed to parse frontmatter: ${error.message}`
				: "failed to parse frontmatter",
		);
	}

	const contentHash = hashContent(data, body);
	const reserved = Object.keys(data).filter((key) => RESERVED_FIELDS.has(key));
	if (reserved.length > 0) {
		return invalid(
			input,
			contentHash,
			`operational field(s) cannot be set in a task spec: ${reserved.join(", ")}`,
		);
	}
	const unknown = Object.keys(data).filter((key) => !ALLOWED_FIELDS.has(key));
	if (unknown.length > 0) {
		return invalid(
			input,
			contentHash,
			`unknown task spec field(s): ${unknown.join(", ")}`,
		);
	}

	if (input.scope === "workspace" && !asNonEmptyString(input.workspaceRoot)) {
		return invalid(
			input,
			contentHash,
			"workspaceRoot is required for workspace-scoped task specs",
		);
	}

	const type = asNonEmptyString(data.type) as AgendaTaskType | undefined;
	if (!type || !TASK_TYPES.has(type)) {
		return invalid(
			input,
			contentHash,
			"type must be one of: suggestion, follow-up, todo, handoff, idea, reminder",
		);
	}

	const title = asNonEmptyString(data.title);
	if (!title) {
		return invalid(input, contentHash, "title is required");
	}
	const instructions = body.trim();
	if (!instructions) {
		return invalid(
			input,
			contentHash,
			"markdown body instructions are required",
		);
	}

	const rawPriority = data.priority ?? 3;
	if (
		!Number.isInteger(rawPriority) ||
		(rawPriority as number) < 0 ||
		(rawPriority as number) > 5
	) {
		return invalid(
			input,
			contentHash,
			"priority must be an integer from 0 to 5",
		);
	}

	const expiresAt = parseIsoTimestamp(data.expiresAt, "expiresAt");
	if (expiresAt instanceof Error) {
		return invalid(input, contentHash, expiresAt.message);
	}
	let availableAt: string | undefined;
	if (data.availableAt !== undefined) {
		const parsed = parseIsoTimestamp(data.availableAt, "availableAt");
		if (parsed instanceof Error) {
			return invalid(input, contentHash, parsed.message);
		}
		availableAt = parsed;
		if (Date.parse(availableAt) >= Date.parse(expiresAt)) {
			return invalid(
				input,
				contentHash,
				"availableAt must be before expiresAt",
			);
		}
	}

	const resourcePaths = parseStringList(data.resourcePaths, "resourcePaths");
	if (resourcePaths instanceof Error) {
		return invalid(input, contentHash, resourcePaths.message);
	}
	let location: ReturnType<typeof normalizeAgendaTaskLocation>;
	try {
		location = normalizeAgendaTaskLocation({
			scope: input.scope,
			workspaceRoot: input.workspaceRoot,
			cwd: asNonEmptyString(data.cwd),
			resourcePaths,
		});
	} catch (error) {
		return invalid(
			input,
			contentHash,
			error instanceof Error ? error.message : String(error),
		);
	}
	const modelSelection = parseModelSelection(data.modelSelection);
	if (modelSelection instanceof Error) {
		return invalid(input, contentHash, modelSelection.message);
	}
	const maxIterations = parsePositiveInteger(
		data.maxIterations,
		"maxIterations",
	);
	if (maxIterations instanceof Error) {
		return invalid(input, contentHash, maxIterations.message);
	}
	const timeoutSeconds = parsePositiveInteger(
		data.timeoutSeconds,
		"timeoutSeconds",
	);
	if (timeoutSeconds instanceof Error) {
		return invalid(input, contentHash, timeoutSeconds.message);
	}

	const rawMode = data.mode;
	if (
		rawMode !== undefined &&
		rawMode !== "act" &&
		rawMode !== "plan" &&
		rawMode !== "yolo"
	) {
		return invalid(input, contentHash, "mode must be one of: act, plan, yolo");
	}
	if (
		data.automationEligible !== undefined &&
		typeof data.automationEligible !== "boolean"
	) {
		return invalid(input, contentHash, "automationEligible must be a boolean");
	}

	return {
		ok: true,
		specPath: input.specPath,
		contentHash,
		spec: {
			taskId: asNonEmptyString(data.taskId),
			type,
			title,
			description: asNonEmptyString(data.description),
			instructions,
			scope: input.scope,
			workspaceRoot: location.workspaceRoot,
			cwd: location.cwd,
			resourcePaths: location.resourcePaths,
			priority: rawPriority as AgendaTaskPriority,
			assignee: asNonEmptyString(data.assignee),
			modelSelection,
			mode: rawMode as "act" | "plan" | "yolo" | undefined,
			systemPrompt: asNonEmptyString(data.systemPrompt),
			maxIterations,
			timeoutSeconds,
			availableAt,
			expiresAt,
			automationEligible: data.automationEligible !== false,
			specPath: input.specPath,
			contentHash,
		},
	};
}

/** Render the canonical, user-editable task spec representation. */
export function serializeAgendaTaskSpec(
	input: AgendaTaskSpecWriteInput,
): string {
	const frontmatter = {
		taskId: input.taskId,
		type: input.type,
		priority: input.priority ?? 3,
		title: input.title,
		...(input.description ? { description: input.description } : {}),
		...(input.availableAt ? { availableAt: input.availableAt } : {}),
		expiresAt: input.expiresAt,
		...(input.cwd ? { cwd: input.cwd } : {}),
		resourcePaths: input.resourcePaths ?? [],
		...(input.assignee ? { assignee: input.assignee } : {}),
		...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
		...(input.mode ? { mode: input.mode } : {}),
		...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
		...(input.maxIterations !== undefined
			? { maxIterations: input.maxIterations }
			: {}),
		...(input.timeoutSeconds !== undefined
			? { timeoutSeconds: input.timeoutSeconds }
			: {}),
		automationEligible: input.automationEligible !== false,
	};
	const yaml = YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd();
	return `---\n${yaml}\n---\n\n${input.instructions.trim()}\n`;
}

export function agendaTaskSpecToCreateInput(
	spec: AgendaTaskSpec,
	createdBy: AgendaTaskActor,
): AgendaTaskCreateInput {
	const expiresAtMs = Date.parse(spec.expiresAt);
	const defaultAvailableAt = new Date(
		Math.min(Date.now(), expiresAtMs - 1),
	).toISOString();
	return {
		taskId: spec.taskId,
		type: spec.type,
		title: spec.title,
		description: spec.description,
		instructions: spec.instructions,
		scope: spec.scope,
		workspaceRoot: spec.workspaceRoot,
		cwd: spec.cwd,
		resourcePaths: spec.resourcePaths,
		priority: spec.priority,
		assignee: spec.assignee,
		modelSelection: spec.modelSelection,
		mode: spec.mode,
		systemPrompt: spec.systemPrompt,
		maxIterations: spec.maxIterations,
		timeoutSeconds: spec.timeoutSeconds,
		availableAt: spec.availableAt ?? defaultAvailableAt,
		expiresAt: spec.expiresAt,
		automationEligible: spec.automationEligible,
		createdBy,
		specPath: spec.specPath,
	};
}
