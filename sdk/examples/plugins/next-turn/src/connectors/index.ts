import type { SourceEnv } from "../context/source";
import type { Log } from "../log";
import type { Settings } from "../settings/settings";
import { connectorAccess } from "./access";
import {
	type ClineConnections,
	type ConnectionLoaders,
	readClineConnections,
} from "./cline-connections";
import { composioConnector, composioToolkits } from "./composio";
import {
	type Access,
	type Connector,
	composioConnectorId,
	mcpConnectorId,
} from "./connector";
import type { GhReader } from "./github/gh";
import { GitHubConnector } from "./github/github";
import { mcpConnector } from "./mcp";
import type { PinnedReadConnector, PinnedReadDeps } from "./pinned";
import { Refresher } from "./refresher";
import { type McpRunnerDeps, mcpRunner } from "./runners";
import { type ConnectorRow, connectorRows } from "./settings-view";

type ConnectorsOptions = {
	loaders: ConnectionLoaders;
	gh: GhReader;
	mcp: McpRunnerDeps;
	settings: () => Settings;
	env: () => SourceEnv;
	/** Whether the plugin is still enabled and installed; the refresher reads nothing while it is not. */
	active?: () => boolean;
	log?: Log;
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
	private detecting: Promise<void> | undefined;

	constructor(private readonly options: ConnectorsOptions) {
		this.github = new GitHubConnector({
			gh: options.gh,
			access: () => this.access(this.github.id),
			now: options.now,
		});
		this.refresher = new Refresher({
			connectors: () => this.all(),
			access: (id) => this.access(id),
			env: options.env,
			active: options.active,
			now: options.now,
			log: options.log,
		});
	}

	private pinnedDeps(connectorId: string): Omit<PinnedReadDeps, "runner"> {
		return {
			access: () => this.access(connectorId),
			reads: () => this.options.settings().connectors[connectorId]?.reads ?? [],
			now: this.options.now,
		};
	}

	/**
	 * Reads Cline's connections and GitHub's routes: when Next starts for this
	 * chat, and after each turn, so a connection added or removed since counts.
	 * Calls that overlap share one read.
	 */
	detect(): Promise<void> {
		this.detecting ??= this.readConnections().finally(() => {
			this.detecting = undefined;
		});
		return this.detecting;
	}

	/** A connector still connected, or in a store that failed to read, keeps its instance and the facts its reads have cached. */
	private async readConnections(): Promise<void> {
		const connections = await readClineConnections(
			this.options.loaders,
			this.connections,
		);
		this.connections = connections;
		const kept = new Map(
			this.pinned.map((connector) => [connector.id, connector]),
		);
		this.pinned = [
			...composioToolkits(connections).map((toolkit) => {
				const id = composioConnectorId(toolkit);
				return kept.get(id) ?? composioConnector(toolkit, this.pinnedDeps(id));
			}),
			...connections.mcp
				.filter((server) => !server.disabled)
				.map((server) => {
					const id = mcpConnectorId(server.name);
					return (
						kept.get(id) ??
						mcpConnector(server, {
							...this.pinnedDeps(id),
							runner: mcpRunner(server.name, this.options.mcp),
						})
					);
				}),
		];
		await this.github.detect(this.options.env(), connections);
	}

	/** After each completed turn: finds connections added or removed since, then refreshes what the turn made due. */
	async onTurn(turn: { pushed?: boolean }): Promise<void> {
		await this.detect().catch((error: unknown) =>
			this.options.log?.("connector detection failed", error),
		);
		await this.refresher.onTurn(turn);
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
		return connectorId === this.github.id
			? this.github.routes(env).length > 0
			: this.pinned.some((connector) => connector.id === connectorId);
	}

	rows(): ConnectorRow[] {
		const env = this.options.env();
		return connectorRows({
			settings: this.options.settings(),
			chatProviderId: env.providerId,
			githubRoutes: this.github.routes(env),
			connections: this.connections ?? { composio: [], mcp: [], channels: [] },
			pins: (connectorId) =>
				this.pinned.find((connector) => connector.id === connectorId)?.scopes ??
				[],
		});
	}
}
