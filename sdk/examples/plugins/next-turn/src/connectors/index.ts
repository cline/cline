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

	/** Reads Cline's connections and GitHub's routes, once Next starts for this chat. */
	async detect(): Promise<void> {
		const connections = await readClineConnections(this.options.loaders);
		this.connections = connections;
		this.pinned = [
			...composioToolkits(connections).map((toolkit) =>
				composioConnector(
					toolkit,
					this.pinnedDeps(composioConnectorId(toolkit)),
				),
			),
			...connections.mcp
				.filter((server) => !server.disabled)
				.map((server) =>
					mcpConnector(server, {
						...this.pinnedDeps(mcpConnectorId(server.name)),
						runner: mcpRunner(server.name, this.options.mcp),
					}),
				),
		];
		await this.github.detect(this.options.env(), connections);
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
