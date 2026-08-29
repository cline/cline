import type {
	CatalogGeneration,
	ToolDescriptor,
	ToolExecutorId,
	ToolId,
} from "@cline/shared/gateway";
import { ToolDescriptorSchema } from "@cline/shared/gateway";

export interface ToolCatalogEntry {
	readonly descriptor: ToolDescriptor;
	readonly executorId: ToolExecutorId;
	readonly available: boolean;
	readonly healthGeneration: number;
}

export interface ToolCatalogSnapshot {
	readonly generation: CatalogGeneration;
	readonly entries: readonly ToolCatalogEntry[];
}

export class ToolCatalog {
	private generation = 0;
	private readonly entries = new Map<ToolId, ToolCatalogEntry>();

	constructor(entries: readonly ToolCatalogEntry[] = builtinToolEntries()) {
		this.replaceSource("builtin", entries);
	}

	get current(): ToolCatalogSnapshot {
		return Object.freeze({
			generation: this.generation,
			entries: Object.freeze([...this.entries.values()]),
		});
	}

	get(toolId: ToolId): ToolCatalogEntry | undefined {
		return this.entries.get(toolId);
	}

	replaceSource(
		source: ToolDescriptor["source"],
		entries: readonly ToolCatalogEntry[],
	): ToolCatalogSnapshot {
		const next = new Map(this.entries);
		for (const [id, entry] of next) {
			if (entry.descriptor.source === source) next.delete(id);
		}
		for (const entry of entries) {
			const descriptor = ToolDescriptorSchema.parse(entry.descriptor);
			if (next.has(descriptor.id)) {
				throw new Error(`Duplicate canonical tool id: ${descriptor.id}`);
			}
			next.set(descriptor.id, Object.freeze({ ...entry, descriptor }));
		}
		this.entries.clear();
		for (const [id, entry] of next) this.entries.set(id, entry);
		this.generation += 1;
		return this.current;
	}

	setExecutorHealth(executorId: ToolExecutorId, available: boolean): void {
		let changed = false;
		for (const [id, entry] of this.entries) {
			if (entry.executorId !== executorId || entry.available === available)
				continue;
			this.entries.set(id, {
				...entry,
				available,
				healthGeneration: entry.healthGeneration + 1,
			});
			changed = true;
		}
		if (changed) this.generation += 1;
	}
}

function descriptor(
	id: string,
	description: string,
	risk: ToolDescriptor["risk"],
	inputSchema: Record<string, unknown>,
): ToolCatalogEntry {
	return {
		descriptor: {
			id,
			version: "1.0.0",
			displayName: id.slice(id.indexOf(":") + 1).replaceAll("_", " "),
			description,
			inputSchema,
			source: "builtin",
			execution: risk === "network" ? "worker" : "worker",
			risk,
			capabilities: [],
			strict: "preferred",
			approval: { mode: "never" },
			resultMode: "single",
			supportsProgress: id === "builtin:run_commands",
			supportsCancellation: true,
			dynamic: false,
		},
		executorId: "worker:builtin",
		available: true,
		healthGeneration: 1,
	};
}

function gatewayDescriptor(
	id: string,
	description: string,
	risk: ToolDescriptor["risk"],
	inputSchema: Record<string, unknown>,
): ToolCatalogEntry {
	const entry = descriptor(id, description, risk, inputSchema);
	return {
		...entry,
		descriptor: { ...entry.descriptor, execution: "gateway" },
		executorId: "gateway:builtin",
	};
}

export function builtinToolEntries(): readonly ToolCatalogEntry[] {
	const object = (properties: Record<string, unknown>, required: string[]) => ({
		type: "object",
		properties,
		required,
		additionalProperties: false,
	});
	return [
		descriptor(
			"builtin:read_files",
			"Read text files in the current workspace, optionally by line range.",
			"read",
			object(
				{
					files: {
						type: "array",
						items: object(
							{
								path: { type: "string" },
								start_line: { type: ["integer", "null"] },
								end_line: { type: ["integer", "null"] },
							},
							["path"],
						),
					},
				},
				["files"],
			),
		),
		descriptor(
			"builtin:search_codebase",
			"Search workspace contents with regular expressions.",
			"read",
			object({ queries: { type: "array", items: { type: "string" } } }, [
				"queries",
			]),
		),
		descriptor(
			"builtin:run_commands",
			"Run shell commands in the sandbox workspace.",
			"execute",
			object({ commands: { type: "array", items: { type: "string" } } }, [
				"commands",
			]),
		),
		descriptor(
			"builtin:editor",
			"Create or edit text files in the workspace.",
			"write",
			object(
				{
					path: { type: "string" },
					old_text: { type: ["string", "null"] },
					new_text: { type: "string" },
					insert_line: { type: ["integer", "null"] },
				},
				["path", "new_text"],
			),
		),
		descriptor(
			"builtin:fetch_web_content",
			"Fetch textual content from HTTPS URLs through sandbox network policy.",
			"network",
			object(
				{
					requests: {
						type: "array",
						items: object(
							{ url: { type: "string" }, prompt: { type: "string" } },
							["url", "prompt"],
						),
					},
				},
				["requests"],
			),
		),
		{
			...descriptor(
				"builtin:ask_question",
				"Ask an attached user one clarifying question with selectable options.",
				"read",
				object(
					{
						question: { type: "string" },
						options: {
							type: "array",
							items: { type: "string" },
							minItems: 2,
							maxItems: 5,
						},
					},
					["question", "options"],
				),
			),
			descriptor: {
				...descriptor(
					"builtin:ask_question",
					"Ask an attached user one clarifying question with selectable options.",
					"read",
					object(
						{
							question: { type: "string" },
							options: { type: "array", items: { type: "string" } },
						},
						["question", "options"],
					),
				).descriptor,
				execution: "gateway",
			},
			executorId: "gateway:builtin",
		},
		gatewayDescriptor(
			"builtin:list_bots",
			"List the active Gateway bots available to the lead bot, including their names, roles, and current status.",
			"read",
			object({}, []),
		),
		gatewayDescriptor(
			"builtin:propose_new_bot",
			"Prepare a new worker-bot proposal for the attached user to review and confirm in the Cline desktop app.",
			"read",
			object(
				{
					name: { type: "string", minLength: 1, maxLength: 80 },
					initialProjectPath: { type: "string", minLength: 1 },
					reason: { type: "string", maxLength: 500 },
					systemPrompt: { type: "string", maxLength: 12_000 },
				},
				["name"],
			),
		),
		descriptor(
			"builtin:submit_and_exit",
			"Submit the final result and finish the run.",
			"read",
			object({ summary: { type: "string" }, verified: { type: "boolean" } }, [
				"summary",
				"verified",
			]),
		),
	];
}
