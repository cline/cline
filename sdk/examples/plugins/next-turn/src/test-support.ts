import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Agent, createTool } from "@cline/core";
import type { AgentMessage, AgentRunResult } from "@cline/shared";
import { resolveClineDir, setClineDir } from "@cline/shared/storage";
import { NEXT_TURN_SCHEMAS } from "./contracts";
import type { NextSession } from "./planner/next";
import type { SessionRuntime } from "./runtime";
import { isRecord } from "./values";

/**
 * Fixtures the test files share. Only `*.test.ts` files import this module,
 * so it never reaches the bundle or its load budget.
 */

/**
 * Temporary directories for one test file, each removed after every test.
 * With `restoreClineDir`, Cline's directory is also put back after every test
 * that called `setClineDir`.
 */
export function useTempDirs(
	prefix: string,
	{ restoreClineDir = false } = {},
): (label?: string) => string {
	const dirs: string[] = [];
	const clineDir = restoreClineDir ? resolveClineDir() : undefined;
	afterEach(() => {
		if (clineDir !== undefined) setClineDir(clineDir);
		for (const dir of dirs.splice(0))
			rmSync(dir, { recursive: true, force: true });
	});
	return (label = "") => {
		const dir = mkdtempSync(join(tmpdir(), `${prefix}${label}`));
		dirs.push(dir);
		return dir;
	};
}

/** A runtime around `next` with no hub, sources or connectors; `activateNext` returns whatever `next` it holds. */
export function fakeRuntime(
	next?: NextSession,
	overrides: Partial<SessionRuntime> = {},
): SessionRuntime {
	const runtime: SessionRuntime = {
		next,
		activateNext: () => runtime.next,
		recordDormantTurn: () => {},
		setTools: () => {},
		stop: () => {},
		...overrides,
	};
	return runtime;
}

/** A lifecycle that never reads the developer's own Cline settings. */
export const alwaysActive = { active: () => true };

type RuntimeConfig = ConstructorParameters<typeof Agent>[0];
export type Model = Extract<RuntimeConfig, { model: unknown }>["model"];

let ids = 0;

export function message(
	role: AgentMessage["role"],
	content: string | AgentMessage["content"],
	extra: Partial<AgentMessage> = {},
): AgentMessage {
	ids += 1;
	return {
		id: `m${ids}`,
		role,
		content:
			typeof content === "string" ? [{ type: "text", text: content }] : content,
		createdAt: ids,
		...extra,
	};
}

export function runResult(
	messages: AgentMessage[],
	overrides: Partial<AgentRunResult> = {},
): AgentRunResult {
	return {
		agentId: "a",
		runId: "run_1",
		status: "completed",
		iterations: 1,
		outputText: "Done.",
		messages,
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		...overrides,
	};
}

/** A completed run in which the agent edited `src/client.ts` for the request. */
export function editRun(request = "Add a retry to the client"): {
	result: AgentRunResult;
	messages: AgentMessage[];
} {
	const ask = message("user", request);
	const edit = message("assistant", [
		{
			type: "tool-call",
			toolCallId: `c${ask.createdAt}`,
			toolName: "editor",
			input: { path: "src/client.ts" },
		},
	]);
	const messages = [ask, edit];
	return {
		messages,
		result: runResult(messages, {
			runId: `run_${edit.createdAt}`,
			outputText: "Added the retry.",
		}),
	};
}

export const editorTool = createTool({
	name: "editor",
	description: "A deterministic test fixture; writes nothing.",
	inputSchema: {
		type: "object",
		properties: { path: { type: "string" } },
		additionalProperties: false,
	},
	execute: async () => "ok",
});

/** Edits `path` through the editor tool on its first call and answers in text after. */
export function editingModel(path = "src/retry.ts"): {
	model: Model;
	calls: () => number;
} {
	let calls = 0;
	return {
		calls: () => calls,
		model: {
			async *stream() {
				calls += 1;
				if (calls === 1) {
					yield {
						type: "tool-call-delta",
						index: 0,
						toolCallId: `c${calls}`,
						toolName: "editor",
						input: { path },
					};
					yield { type: "finish", reason: "tool-calls" };
				} else {
					yield { type: "text-delta", text: `Done (${calls}).` };
					yield { type: "finish", reason: "stop" };
				}
			},
		},
	};
}

/** The published schema named `name` (`NextTurnSet`, `NextTurnTrayAction`, ...). */
export function contractSchema(name: string): Record<string, unknown> {
	const entry = NEXT_TURN_SCHEMAS.find((candidate) => candidate.name === name);
	if (!entry) throw new Error(`no schema ${name}`);
	return entry.schema;
}

function hasType(value: unknown, type: unknown): boolean {
	switch (type) {
		case "object":
			return isRecord(value);
		case "array":
			return Array.isArray(value);
		case "integer":
			return Number.isInteger(value);
		default:
			return typeof value === type;
	}
}

/**
 * What `value` breaks in a JSON Schema, as JSON paths: only the keywords the
 * contracts use. A property left undefined is absent, as it is on the wire.
 */
export function schemaErrors(
	schema: Record<string, unknown>,
	value: unknown,
	path = "$",
): string[] {
	const errors: string[] = [];
	const fail = (problem: string) => errors.push(`${path} ${problem}`);
	const nested = (child: unknown, item: unknown, at: string) => {
		if (isRecord(child)) errors.push(...schemaErrors(child, item, at));
	};
	if ("const" in schema && value !== schema.const)
		fail(`must be ${JSON.stringify(schema.const)}`);
	if (Array.isArray(schema.enum) && !schema.enum.includes(value))
		fail("is not one of the enum");
	if (schema.type !== undefined && !hasType(value, schema.type)) {
		fail(`must be ${schema.type}`);
		return errors;
	}
	if (typeof value === "string") {
		if (
			typeof schema.pattern === "string" &&
			!new RegExp(schema.pattern).test(value)
		)
			fail(`must match ${schema.pattern}`);
		if (typeof schema.minLength === "number" && value.length < schema.minLength)
			fail("is too short");
		if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
			fail("is too long");
	}
	if (typeof value === "number") {
		if (typeof schema.minimum === "number" && value < schema.minimum)
			fail("is below the minimum");
		if (typeof schema.maximum === "number" && value > schema.maximum)
			fail("is above the maximum");
	}
	if (Array.isArray(value)) {
		if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
			fail("has too many items");
		value.forEach((item, index) => {
			nested(schema.items, item, `${path}[${index}]`);
		});
	}
	if (isRecord(value)) {
		const properties = isRecord(schema.properties) ? schema.properties : {};
		const required = Array.isArray(schema.required) ? schema.required : [];
		for (const key of required)
			if (value[key] === undefined) fail(`needs ${key}`);
		for (const [key, item] of Object.entries(value)) {
			if (item === undefined) continue;
			if (key in properties) nested(properties[key], item, `${path}.${key}`);
			else if (schema.additionalProperties === false)
				fail(`does not name ${key}`);
			else nested(schema.additionalProperties, item, `${path}.${key}`);
		}
	}
	if (Array.isArray(schema.oneOf)) {
		const matches = schema.oneOf.filter(
			(branch) => isRecord(branch) && schemaErrors(branch, value).length === 0,
		).length;
		if (matches !== 1) fail(`matches ${matches} of oneOf, not exactly one`);
	}
	return errors;
}
