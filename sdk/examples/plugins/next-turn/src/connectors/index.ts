import { MINUTE_MS } from "../config";
import type { SourceEnv } from "../context/source";
import type { PinnedRead, Settings } from "../settings/settings";
import { connectorAccess } from "./access";
import {
	type ClineConnections,
	type ConnectionLoaders,
	readClineConnections,
} from "./cline-connections";
import { composioConnector, composioToolkits } from "./composio";
import type { Access, Connector } from "./connector";
import type { GhReader } from "./github/gh";
import { GitHubConnector } from "./github/github";
import { mcpConnector } from "./mcp";
import type { PinnedReadConnector, ToolRunner } from "./pinned";
import { Refresher } from "./refresher";
import type { McpRunnerDeps } from "./runners";
import { mcpRunner } from "./runners";
import { type ConnectorRow, connectorRows } from "./settings-view";

export type ConnectorsOptions = {
	loaders: ConnectionLoaders;
	gh: GhReader;
	/** Cline's Composio tools as a runner, or why they cannot run here (upstream ask U4 at the pin). */
	composio: () => Promise<ToolRunner | { reason: string }>;
	mcp: McpRunnerDeps;
	settings: () => Settings;
	env: () => SourceEnv;
	log?: (message: string, error?: unknown) => void;
	now?: () => number;
};

/**
 * Every connector for one chat: detection of the person's Cline
 * connections, each connector's access, the background refresher, and the
 * settings rows. Connectors are sources, so the planner's manifest and facts
 * take them like any other.
 */
export class Connectors {
	readonly github: GitHubConnector;
	readonly refresher: Refresher;
	private connections: ClineConnections | undefined;
	private pinned: PinnedReadConnector[] = [];
	private composioReady: ToolRunner | { reason: string } | undefined;

	constructor(private readonly options: ConnectorsOptions) {
		this.github = new GitHubConnector({
			gh: options.gh,
			connections: async () =>
				this.connections ?? (await this.detectConnections()),
			access: () => this.access("github"),
			now: options.now,
		});
		this.refresher = new Refresher({
			connectors: () => this.all(),
			access: (id) => this.access(id),
			env: options.env,
			tickMs: MINUTE_MS,
			now: options.now,
			log: options.log,
		});
	}

	private reads(connectorId: string): readonly PinnedRead[] {
		return this.options.settings().connectors[connectorId]?.reads ?? [];
	}

	private async detectConnections(): Promise<ClineConnections> {
		const connections = await readClineConnections(this.options.loaders);
		this.connections = connections;
		const composioRunner = async () =>
			this.composioReady ?? { reason: "Composio has not been checked yet" };
		this.pinned = [
			...composioToolkits(connections).map((toolkit) =>
				composioConnector(toolkit, {
					connected: () =>
						this.connections?.composio.some(
							(entry) => entry.toolkit === toolkit && entry.connected,
						),
					access: () => this.access(`composio:${toolkit}`),
					reads: () => this.reads(`composio:${toolkit}`),
					runner: composioRunner,
					now: this.options.now,
				}),
			),
			...connections.mcp
				.filter((server) => !server.disabled)
				.map((server) =>
					mcpConnector(server, {
						enabled: () =>
							this.connections?.mcp.some(
								(entry) => entry.name === server.name && !entry.disabled,
							),
						access: () => this.access(`mcp:${server.name}`),
						reads: () => this.reads(`mcp:${server.name}`),
						runner: mcpRunner(server.name, this.options.mcp),
						now: this.options.now,
					}),
				),
		];
		return connections;
	}

	/** Re-reads Cline's connections, GitHub's routes and whether Composio tools can run; for chat start and settings changes. */
	async detect(): Promise<void> {
		await this.detectConnections();
		const [composio] = await Promise.all([
			this.options.composio().catch((error: unknown) => ({
				reason: error instanceof Error ? error.message : String(error),
			})),
			this.github.detect(this.options.env()),
		]);
		this.composioReady = composio;
	}

	all(): Connector[] {
		return [this.github, ...this.pinned];
	}

	access(connectorId: string): Access {
		const env = this.options.env();
		return connectorAccess(
			this.options.settings(),
			connectorId,
			this.detected(connectorId, env),
			env.providerId,
		);
	}

	private detected(connectorId: string, env: SourceEnv): boolean {
		if (connectorId === "github") return this.github.routes(env).length > 0;
		if (connectorId.startsWith("composio:")) {
			return (
				this.connections?.composio.some(
					(entry) =>
						`composio:${entry.toolkit}` === connectorId && entry.connected,
				) ?? false
			);
		}
		if (connectorId.startsWith("mcp:")) {
			return (
				this.connections?.mcp.some(
					(entry) => `mcp:${entry.name}` === connectorId && !entry.disabled,
				) ?? false
			);
		}
		return false;
	}

	rows(): ConnectorRow[] {
		const env = this.options.env();
		return connectorRows({
			settings: this.options.settings(),
			chatProviderId: env.providerId,
			githubRoutes: this.github.routes(env),
			connections: this.connections ?? { composio: [], mcp: [], channels: [] },
			composioReadReason:
				typeof this.composioReady === "function"
					? undefined
					: (this.composioReady?.reason ?? "Composio has not been checked yet"),
			pins: (connectorId) =>
				this.pinned.find((connector) => connector.id === connectorId)?.scopes ??
				[],
		});
	}
}
