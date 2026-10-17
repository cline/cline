import type { HubEventName } from "@cline/shared";
import { SETUP_NAMES_MAX } from "../../config";
import type { HubLink, HubLinkScope } from "../../hub/link";
import type { Log } from "../../log";
import { isRecord, listOf } from "../../values";
import type { ContextSource, Facts, SourceState } from "../source";

/**
 * The person's Cline setup: workflows, skills, plugin commands and the MCP
 * servers portable Agent Plugins bring, so a suggestion can name the person's
 * own tools ("Run /release-notes for this change"). MCP servers from the
 * settings file are left to their own connectors, so a server the person set
 * to Off is never named; an Agent Plugin's servers have no connector, so only
 * the setup names them.
 *
 * - **Read:** `settings.list { workspaceRoot, cwd, includePluginTools: false }`,
 *   whose reply is `{ snapshot: CoreSettingsSnapshot }`. Plugin slash
 *   commands appear only as `contributions.commands` on plugin items;
 *   `prompt_commands.list` has no hub handler.
 * - **Names only:** a workflow item's `description` is its instructions, so
 *   descriptions are never read.
 * - **Freshness:** read when the link comes up and again on `settings.changed`.
 *   The probe answers from that cache, so it costs nothing on a turn.
 */

type SetupInventory = {
	workflows: string[];
	skills: string[];
	mcp: string[];
	pluginCommands: string[];
};

type SetupLink = Pick<
	HubLink,
	"availability" | "onStatus" | "subscribe" | "command"
>;

const SETTINGS_CHANGED: ReadonlySet<HubEventName> = new Set([
	"settings.changed",
]);

function usable(item: Record<string, unknown>): boolean {
	return item.enabled !== false && !item.loadError;
}

function capped(values: Iterable<string>): string[] {
	return [...new Set(values)].sort().slice(0, SETUP_NAMES_MAX);
}

function usableNames(
	snapshot: unknown,
	key: string,
	keep: (item: Record<string, unknown>) => boolean = () => true,
): string[] {
	return listOf(snapshot, key)
		.filter((item) => usable(item) && keep(item))
		.flatMap((item) =>
			typeof item.name === "string" && item.name.trim()
				? [item.name.trim()]
				: [],
		);
}

function slash(name: string): string {
	const bare = name.replace(/^\/+/, "").replace(/\.md$/i, "");
	return `/${bare}`;
}

/** The inventory from a `settings.list` reply; anything unexpected reads as empty. */
export function parseSetup(reply: Record<string, unknown>): SetupInventory {
	const pluginCommands = listOf(reply.snapshot, "plugins")
		.filter(usable)
		.flatMap((plugin) =>
			isRecord(plugin.contributions) &&
			Array.isArray(plugin.contributions.commands)
				? plugin.contributions.commands
				: [],
		)
		.filter(
			(command): command is string =>
				typeof command === "string" && command.trim() !== "",
		)
		.map((command) => slash(command.trim()));
	return {
		workflows: capped(usableNames(reply.snapshot, "workflows").map(slash)),
		skills: capped(usableNames(reply.snapshot, "skills")),
		mcp: capped(
			usableNames(reply.snapshot, "mcp", (item) => item.agentPlugin === true),
		),
		pluginCommands: capped(pluginCommands),
	};
}

function setupTags(inventory: SetupInventory): string[] {
	return [
		...inventory.workflows.map((name) => `workflow:${name}`),
		...inventory.skills.map((name) => `skill:${name}`),
		...inventory.mcp.map((name) => `mcp:${name}`),
		...inventory.pluginCommands.map((name) => `plugin-command:${name}`),
	];
}

function setupFacts(inventory: SetupInventory): Facts {
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
	readonly displayName = "Your Cline setup";
	readonly settingsToggle = "clineSetup" as const;
	private inventory: SetupInventory | undefined;
	private readonly teardown: Array<() => void> = [];

	constructor(
		private readonly link: SetupLink,
		private readonly scope: HubLinkScope = {},
		private readonly log?: Log,
	) {}

	/** Read now if the link is already up, then on every connect and every `settings.changed`. */
	start(): void {
		this.teardown.push(
			this.link.onStatus((status) => {
				if (status === "up") void this.refresh();
			}),
		);
		this.teardown.push(
			this.link.subscribe(SETTINGS_CHANGED, () => void this.refresh()),
		);
		if (this.link.availability() === "present") void this.refresh();
	}

	stop(): void {
		for (const stop of this.teardown.splice(0)) stop();
	}

	private async refresh(): Promise<void> {
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
