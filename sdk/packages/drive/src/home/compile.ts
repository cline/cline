/**
 * Pure Driveagent home → ConfiguredAgent-shaped compile (DRV-DRIVEAGENT-HOME).
 *
 * Value-imports from `@cline/shared` are forbidden in this package; callers
 * (or tests) parse YAML with shared schemas, then pass the typed home here.
 */

import type { DriveagentHome } from "@cline/shared";

export type CompiledDriveagentView = {
	readonly name: string;
	readonly slug: string;
	readonly description: string;
	readonly tools?: readonly string[];
	readonly skills?: readonly string[];
	readonly systemPrompt?: string;
	readonly promptPath?: string;
	readonly providerId?: string;
	readonly modelId?: string;
	readonly maxIterations?: number;
};

export type DriveagentHomeCompileErrorCode =
	| "unknown_agent"
	| "invalid_home";

export class DriveagentHomeCompileError extends Error {
	readonly code: DriveagentHomeCompileErrorCode;

	constructor(code: DriveagentHomeCompileErrorCode, message: string) {
		super(message);
		this.name = "DriveagentHomeCompileError";
		this.code = code;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.every((entry) => typeof entry === "string" && entry.length > 0)
	);
}

/**
 * Structural guard so compile stays pure and shared-schema-free at runtime.
 * Invalid / incomplete homes throw `DriveagentHomeCompileError`.
 */
function assertDriveagentHome(input: unknown): DriveagentHome {
	if (!isRecord(input)) {
		throw new DriveagentHomeCompileError(
			"invalid_home",
			"Driveagent home must be an object",
		);
	}
	if (!isNonEmptyString(input.slug)) {
		throw new DriveagentHomeCompileError(
			"unknown_agent",
			"Driveagent home is missing a slug",
		);
	}
	if (!/^[a-z0-9-]+$/.test(input.slug)) {
		throw new DriveagentHomeCompileError(
			"unknown_agent",
			`Unknown or invalid Driveagent slug: ${input.slug}`,
		);
	}
	if (!isRecord(input.agent)) {
		throw new DriveagentHomeCompileError(
			"invalid_home",
			`Driveagent home '${input.slug}' is missing agent.yaml fields`,
		);
	}
	const agent = input.agent;
	if (!isNonEmptyString(agent.name) || !isNonEmptyString(agent.description)) {
		throw new DriveagentHomeCompileError(
			"invalid_home",
			`Driveagent home '${input.slug}' agent.yaml requires name and description`,
		);
	}
	if (agent.name !== input.slug) {
		throw new DriveagentHomeCompileError(
			"invalid_home",
			`Driveagent home '${input.slug}' agent.name '${agent.name}' must match slug`,
		);
	}
	if (!isNonEmptyString(agent.systemPrompt) && !isNonEmptyString(agent.promptPath)) {
		throw new DriveagentHomeCompileError(
			"invalid_home",
			`Driveagent home '${input.slug}' requires systemPrompt or promptPath`,
		);
	}
	if (agent.tools !== undefined && !isStringArray(agent.tools)) {
		throw new DriveagentHomeCompileError(
			"invalid_home",
			`Driveagent home '${input.slug}' tools must be a string array`,
		);
	}
	if (agent.skills !== undefined && !isStringArray(agent.skills)) {
		throw new DriveagentHomeCompileError(
			"invalid_home",
			`Driveagent home '${input.slug}' skills must be a string array`,
		);
	}
	if (!isRecord(input.permissions)) {
		throw new DriveagentHomeCompileError(
			"invalid_home",
			`Driveagent home '${input.slug}' is missing permissions.yaml fields`,
		);
	}
	if (!isRecord(input.env)) {
		throw new DriveagentHomeCompileError(
			"invalid_home",
			`Driveagent home '${input.slug}' is missing env.yaml fields`,
		);
	}
	return input as DriveagentHome;
}

/**
 * Project a parsed Driveagent home into a ConfiguredAgent-shaped runtime view.
 */
export function compileDriveagentHome(
	home: DriveagentHome | unknown,
): CompiledDriveagentView {
	const parsed = assertDriveagentHome(home);
	const { agent, slug } = parsed;

	const view: CompiledDriveagentView = {
		name: agent.name,
		slug,
		description: agent.description,
		...(agent.tools !== undefined ? { tools: [...agent.tools] } : {}),
		...(agent.skills !== undefined ? { skills: [...agent.skills] } : {}),
		...(agent.systemPrompt !== undefined
			? { systemPrompt: agent.systemPrompt }
			: {}),
		...(agent.promptPath !== undefined ? { promptPath: agent.promptPath } : {}),
		...(agent.providerId !== undefined ? { providerId: agent.providerId } : {}),
		...(agent.modelId !== undefined ? { modelId: agent.modelId } : {}),
		...(agent.maxIterations !== undefined
			? { maxIterations: agent.maxIterations }
			: {}),
	};
	return view;
}
