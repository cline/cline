import type { AtifContent, AtifStep, AtifTrajectory } from "./atif-types";
import atifSchema from "./atif-v1.7.schema.json";

type JsonSchema = Record<string, unknown>;

/** Keywords that constrain values; the vendored schema uses only these. */
const ASSERTION_KEYWORDS = new Set([
	"$ref",
	"anyOf",
	"type",
	"enum",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"minItems",
	"minimum",
]);
const ANNOTATION_KEYWORDS = new Set([
	"$schema",
	"$id",
	"$comment",
	"$defs",
	"title",
	"description",
	"default",
]);

export interface AtifValidationResult {
	ok: boolean;
	errors: string[];
}

export interface AtifValidationOptions {
	/**
	 * Require every subagent reference that has a `trajectory_id` and no
	 * `trajectory_path` to name an entry of the same trajectory's
	 * `subagent_trajectories`. The RFC resolves embedded references this way;
	 * Harbor's models do not check it. Defaults to true.
	 */
	requireResolvableRefs?: boolean;
}

let checkedSchema: JsonSchema | undefined;

/**
 * The vendored schema, after checking that it only uses keywords this
 * validator implements. A regenerated schema that starts using another
 * keyword fails here instead of being silently under-checked.
 */
function loadSchema(): JsonSchema {
	if (checkedSchema) return checkedSchema;
	const schema = atifSchema as JsonSchema;
	const visit = (node: unknown, path: string): void => {
		if (!node || typeof node !== "object" || Array.isArray(node)) {
			throw new Error(`ATIF schema: ${path} is not a schema object`);
		}
		for (const [key, value] of Object.entries(node)) {
			if (!ASSERTION_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
				throw new Error(`ATIF schema: unsupported keyword "${key}" at ${path}`);
			}
			if (key === "$defs" || key === "properties") {
				for (const [name, child] of Object.entries(
					value as Record<string, unknown>,
				)) {
					visit(child, `${path}/${key}/${name}`);
				}
			} else if (key === "anyOf") {
				for (const [index, child] of (value as unknown[]).entries()) {
					visit(child, `${path}/anyOf/${index}`);
				}
			} else if (
				key === "items" ||
				(key === "additionalProperties" && typeof value === "object")
			) {
				visit(value, `${path}/${key}`);
			}
		}
	};
	visit(schema, "#");
	checkedSchema = schema;
	return schema;
}

function resolveRef(root: JsonSchema, ref: string): JsonSchema {
	const match = /^#\/\$defs\/([^/]+)$/.exec(ref);
	const defs = root.$defs as Record<string, JsonSchema> | undefined;
	const target = match ? defs?.[match[1] ?? ""] : undefined;
	if (!target) {
		throw new Error(`ATIF schema: cannot resolve $ref ${ref}`);
	}
	return target;
}

function typeOf(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
	switch (type) {
		case "null":
			return value === null;
		case "string":
			return typeof value === "string";
		case "boolean":
			return typeof value === "boolean";
		case "integer":
			return typeof value === "number" && Number.isInteger(value);
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "array":
			return Array.isArray(value);
		case "object":
			return typeOf(value) === "object";
		default:
			throw new Error(`ATIF schema: unsupported type "${type}"`);
	}
}

function label(path: string): string {
	return path || "(root)";
}

function validateNode(
	root: JsonSchema,
	schema: JsonSchema,
	value: unknown,
	path: string,
	errors: string[],
): void {
	if (typeof schema.$ref === "string") {
		validateNode(root, resolveRef(root, schema.$ref), value, path, errors);
	}
	if (Array.isArray(schema.anyOf)) {
		const branches = (schema.anyOf as JsonSchema[]).map((branch) => {
			const branchErrors: string[] = [];
			validateNode(root, branch, value, path, branchErrors);
			return { branch, errors: branchErrors };
		});
		if (!branches.some((candidate) => candidate.errors.length === 0)) {
			const sameType = branches.filter((candidate) => {
				const target = candidate.branch.$ref
					? resolveRef(root, candidate.branch.$ref as string)
					: candidate.branch;
				return (
					typeof target.type === "string" &&
					value !== null &&
					matchesType(value, target.type)
				);
			});
			if (sameType.length === 1) {
				errors.push(...(sameType[0]?.errors ?? []));
			} else {
				errors.push(
					`${label(path)}: ${typeOf(value)} does not match any allowed type`,
				);
			}
		}
	}
	if (typeof schema.type === "string" && !matchesType(value, schema.type)) {
		errors.push(
			`${label(path)}: expected ${schema.type}, got ${typeOf(value)}`,
		);
		return;
	}
	if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
		errors.push(
			`${label(path)}: must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`,
		);
	}
	if (
		typeof schema.minimum === "number" &&
		typeof value === "number" &&
		value < schema.minimum
	) {
		errors.push(`${label(path)}: must be >= ${schema.minimum}`);
	}
	if (Array.isArray(value)) {
		if (typeof schema.minItems === "number" && value.length < schema.minItems) {
			errors.push(
				`${label(path)}: must have at least ${schema.minItems} item(s)`,
			);
		}
		if (schema.items && typeof schema.items === "object") {
			for (const [index, item] of value.entries()) {
				validateNode(
					root,
					schema.items as JsonSchema,
					item,
					`${path}[${index}]`,
					errors,
				);
			}
		}
	}
	if (typeOf(value) === "object") {
		const record = value as Record<string, unknown>;
		const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
		for (const key of (schema.required ?? []) as string[]) {
			if (!(key in record)) {
				errors.push(`${label(path)}: missing required field "${key}"`);
			}
		}
		for (const [key, child] of Object.entries(record)) {
			const childPath = path ? `${path}.${key}` : key;
			const propertySchema = properties[key];
			if (propertySchema) {
				validateNode(root, propertySchema, child, childPath, errors);
			} else if (schema.additionalProperties === false) {
				errors.push(`${label(path)}: unknown field "${key}"`);
			} else if (
				schema.additionalProperties &&
				typeof schema.additionalProperties === "object"
			) {
				validateNode(
					root,
					schema.additionalProperties as JsonSchema,
					child,
					childPath,
					errors,
				);
			}
		}
	}
}

const ISO_8601 =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?(?:Z|[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:\.\d+)?)?)?)?)?$/;

/**
 * Approximates Python's `datetime.fromisoformat`, which Harbor uses to check
 * step timestamps: extended ISO 8601 dates with optional time and offset.
 */
function isIsoTimestamp(value: string): boolean {
	const match = ISO_8601.exec(value);
	if (!match) return false;
	const [year, month, day, hour, minute, second] = match
		.slice(1)
		.map((part) => (part === undefined ? 0 : Number(part)));
	if (!month || month > 12 || !day) return false;
	const daysInMonth = new Date(Date.UTC(year ?? 0, month, 0)).getUTCDate();
	return (
		day <= daysInMonth &&
		(hour ?? 0) < 24 &&
		(minute ?? 0) < 60 &&
		(second ?? 0) < 60
	);
}

function isPresent(value: unknown): boolean {
	return value !== undefined && value !== null;
}

const AGENT_ONLY_FIELDS = [
	"model_name",
	"reasoning_effort",
	"reasoning_content",
	"tool_calls",
	"metrics",
] as const;

function checkContentParts(
	content: AtifContent | null | undefined,
	path: string,
	errors: string[],
): void {
	if (!Array.isArray(content)) return;
	for (const [index, part] of content.entries()) {
		const record = part as Record<string, unknown>;
		const partPath = `${path}[${index}]`;
		if (record.type === "text") {
			if (!isPresent(record.text)) {
				errors.push(`${partPath}: "text" is required when type is "text"`);
			}
			if (isPresent(record.source)) {
				errors.push(`${partPath}: "source" is not allowed when type is "text"`);
			}
		} else if (record.type === "image") {
			if (!isPresent(record.source)) {
				errors.push(`${partPath}: "source" is required when type is "image"`);
			}
			if (isPresent(record.text)) {
				errors.push(`${partPath}: "text" is not allowed when type is "image"`);
			}
		}
	}
}

function checkStep(step: AtifStep, path: string, errors: string[]): void {
	if (typeof step.timestamp === "string" && !isIsoTimestamp(step.timestamp)) {
		errors.push(`${path}.timestamp: not an ISO 8601 timestamp`);
	}
	if (step.source !== "agent") {
		for (const field of AGENT_ONLY_FIELDS) {
			if (isPresent(step[field])) {
				errors.push(
					`${path}.${field}: only allowed when source is "agent", but source is "${step.source}"`,
				);
			}
		}
	} else if (step.llm_call_count === 0) {
		for (const field of ["metrics", "reasoning_content"] as const) {
			if (isPresent(step[field])) {
				errors.push(
					`${path}.${field}: must be absent when llm_call_count is 0 on an agent step`,
				);
			}
		}
	}
	checkContentParts(step.message, `${path}.message`, errors);
	const callIds = new Set(
		(step.tool_calls ?? []).map((call) => call.tool_call_id),
	);
	for (const [index, result] of (step.observation?.results ?? []).entries()) {
		const resultPath = `${path}.observation.results[${index}]`;
		if (
			typeof result.source_call_id === "string" &&
			!callIds.has(result.source_call_id)
		) {
			errors.push(
				`${resultPath}.source_call_id: "${result.source_call_id}" is not a tool_call_id of step ${step.step_id}`,
			);
		}
		checkContentParts(result.content, `${resultPath}.content`, errors);
		for (const [refIndex, ref] of (
			result.subagent_trajectory_ref ?? []
		).entries()) {
			if (!isPresent(ref.trajectory_id) && !isPresent(ref.trajectory_path)) {
				errors.push(
					`${resultPath}.subagent_trajectory_ref[${refIndex}]: needs trajectory_id or trajectory_path`,
				);
			}
		}
	}
}

function checkTrajectory(
	trajectory: AtifTrajectory,
	path: string,
	options: Required<AtifValidationOptions>,
	errors: string[],
): void {
	const prefix = path ? `${path}.` : "";
	for (const [index, step] of trajectory.steps.entries()) {
		const stepPath = `${prefix}steps[${index}]`;
		if (step.step_id !== index + 1) {
			errors.push(
				`${stepPath}.step_id: expected ${index + 1} (sequential from 1), got ${step.step_id}`,
			);
		}
		checkStep(step, stepPath, errors);
	}
	const embeddedIds = new Set<string>();
	for (const [index, sub] of (
		trajectory.subagent_trajectories ?? []
	).entries()) {
		const subPath = `${prefix}subagent_trajectories[${index}]`;
		if (!isPresent(sub.trajectory_id)) {
			errors.push(
				`${subPath}.trajectory_id: required on embedded subagent trajectories`,
			);
		} else if (embeddedIds.has(sub.trajectory_id as string)) {
			errors.push(
				`${subPath}.trajectory_id: "${sub.trajectory_id}" is not unique within subagent_trajectories`,
			);
		} else {
			embeddedIds.add(sub.trajectory_id as string);
		}
		checkTrajectory(sub, subPath, options, errors);
	}
	if (!options.requireResolvableRefs) return;
	for (const [index, step] of trajectory.steps.entries()) {
		for (const [resultIndex, result] of (
			step.observation?.results ?? []
		).entries()) {
			for (const [refIndex, ref] of (
				result.subagent_trajectory_ref ?? []
			).entries()) {
				if (
					typeof ref.trajectory_id === "string" &&
					!isPresent(ref.trajectory_path) &&
					!embeddedIds.has(ref.trajectory_id)
				) {
					errors.push(
						`${prefix}steps[${index}].observation.results[${resultIndex}].subagent_trajectory_ref[${refIndex}]: trajectory_id "${ref.trajectory_id}" does not match an embedded subagent trajectory`,
					);
				}
			}
		}
	}
}

/**
 * Validates a value against the vendored ATIF v1.7 JSON Schema, then (when
 * the shape is valid) against the cross-field rules Harbor's Pydantic
 * models enforce: sequential step ids, ISO 8601 timestamps, agent-only
 * fields, `llm_call_count: 0` restrictions, unique embedded trajectory ids,
 * `source_call_id` matching a tool call of its step, resolvable subagent
 * references, and text/image content part fields.
 */
export function validateAtifTrajectory(
	value: unknown,
	options: AtifValidationOptions = {},
): AtifValidationResult {
	const schema = loadSchema();
	const errors: string[] = [];
	validateNode(schema, schema, value, "", errors);
	if (errors.length === 0) {
		checkTrajectory(
			value as AtifTrajectory,
			"",
			{ requireResolvableRefs: options.requireResolvableRefs ?? true },
			errors,
		);
	}
	return { ok: errors.length === 0, errors };
}
