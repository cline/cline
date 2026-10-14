import { SETUP_NAMES_MAX } from "../../config";
import { isRecord } from "../../hub/fold";
import type { HubEvent, HubLinkStatus } from "../../hub/link";
import type { ContextSource, Facts, SourceState } from "../source";

/**
 * The person's Cline setup: workflows, skills, MCP servers and
 * plugin commands, so a suggestion can name the person's own tools ("Run
 * /release-notes for this change"). A suggestion that names one is offered
 * only when its capability tag is present.
 *
 * - **Read:** `settings.list { workspaceRoot, cwd, includePluginTools: false }`,
 *   whose reply is `{ snapshot: CoreSettingsSnapshot }`. Plugin slash
 *   commands appear only as `contributions.commands` on plugin items;
 *   `prompt_commands.list` is not handled at the pin.
 * - **Names only:** a workflow item's `description` is its instructions, so
 *   descriptions are never read.
 * - **Freshness:** read when the link comes up and again on `settings.changed`.
 *   The probe answers from that cache, so it costs nothing on a turn.
 * - **Tier:** T2, local Cline read through the hub.
 */

export type SetupInventory = {
	workflows: string[];
	skills: string[];
	mcp: string[];
	pluginCommands: string[];
};

export type SetupLink = {
	availability(): "present" | "unknown" | "absent";
	onStatus(listener: (status: HubLinkStatus) => void): () => void;
	subscribe(
		names: ReadonlySet<string>,
		listener: (event: HubEvent) => void,
	): () => void;
	command(
		name: string,
		payload?: Record<string, unknown>,
	): Promise<Record<string, unknown>>;
};

const SETTINGS_CHANGED: ReadonlySet<string> = new Set(["settings.changed"]);

function usable(item: Record<string, unknown>): boolean {
	return item.enabled !== false && !item.loadError;
}

function names(items: unknown): string[] {
	if (!Array.isArray(items)) return [];
	const out = new Set<string>();
	for (const item of items) {
		if (
			isRecord(item) &&
			usable(item) &&
			typeof item.name === "string" &&
			item.name.trim()
		)
			out.add(item.name.trim());
	}
	return [...out].sort().slice(0, SETUP_NAMES_MAX);
}

function slash(name: string): string {
	const bare = name.replace(/^\/+/, "").replace(/\.md$/i, "");
	return `/${bare}`;
}

/** The inventory from a `settings.list` reply; anything unexpected reads as empty. */
export function parseSetup(reply: Record<string, unknown>): SetupInventory {
	const snapshot = isRecord(reply.snapshot) ? reply.snapshot : {};
	const commands = new Set<string>();
	for (const plugin of Array.isArray(snapshot.plugins)
		? snapshot.plugins
		: []) {
		if (!isRecord(plugin) || !usable(plugin) || !isRecord(plugin.contributions))
			continue;
		const contributed = plugin.contributions.commands;
		for (const command of Array.isArray(contributed) ? contributed : []) {
			if (typeof command === "string" && command.trim())
				commands.add(slash(command.trim()));
		}
	}
	return {
		workflows: names(snapshot.workflows).map(slash),
		skills: names(snapshot.skills),
		mcp: names(snapshot.mcp),
		pluginCommands: [...commands].sort().slice(0, SETUP_NAMES_MAX),
	};
}

export function setupTags(inventory: SetupInventory): string[] {
	return [
		...inventory.workflows.map((name) => `workflow:${name}`),
		...inventory.skills.map((name) => `skill:${name}`),
		...inventory.mcp.map((name) => `mcp:${name}`),
		...inventory.pluginCommands.map((name) => `plugin-command:${name}`),
	];
}

export function setupFacts(inventory: SetupInventory): Facts {
	const line = (label: string, list: string[]) =>
		list.length > 0 ? `${label}: ${list.join(", ")}` : "";
	return {
		heading: "The person's Cline setup",
		lines: [
			line("Workflows", inventory.workflows),
			line("Skills", inventory.skills),
			line("MCP servers", inventory.mcp),
			line("Plugin commands", inventory.pluginCommands),
		].filter(Boolean),
	};
}

export class ClineSetupSource implements ContextSource {
	readonly id = "cline-setup";
	readonly tier = "T2" as const;
	private inventory: SetupInventory | undefined;
	private readonly teardown: Array<() => void> = [];

	constructor(
		private readonly link: SetupLink,
		private readonly scope: { workspaceRoot?: string; cwd?: string } = {},
		private readonly log?: (message: string, error?: unknown) => void,
	) {}

	/** Read on every connect and every `settings.changed`. */
	start(): void {
		this.teardown.push(
			this.link.onStatus((status) => {
				if (status === "up") void this.refresh();
			}),
		);
		this.teardown.push(
			this.link.subscribe(SETTINGS_CHANGED, () => void this.refresh()),
		);
	}

	stop(): void {
		for (const stop of this.teardown.splice(0)) stop();
	}

	async refresh(): Promise<void> {
		try {
			const reply = await this.link.command("settings.list", {
				workspaceRoot: this.scope.workspaceRoot,
				cwd: this.scope.cwd ?? this.scope.workspaceRoot,
				includePluginTools: false,
			});
			this.inventory = parseSetup(reply);
		} catch (error) {
			this.log?.(
				"settings.list failed; the Cline setup stays as last read",
				error,
			);
		}
	}

	current(): SetupInventory | undefined {
		return this.inventory;
	}

	probe(): SourceState {
		if (this.inventory) return "present";
		return this.link.availability() === "absent" ? "absent" : "unknown";
	}

	capabilities(): string[] {
		return this.inventory ? setupTags(this.inventory) : [];
	}

	facts(): Facts | "unknown" {
		return this.inventory ? setupFacts(this.inventory) : "unknown";
	}
}
