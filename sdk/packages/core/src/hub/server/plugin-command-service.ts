import { resolve } from "node:path";
import type {
	BasicLogger,
	HubCommandEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import {
	createPluginCommandService,
	type PluginCommandService,
} from "../../services/plugin-commands";
import { installPlugin } from "../../services/plugin-install";
import { errorReply, okReply } from "./handlers/context";

/** Plugin sandboxes and install-time contribution loading belong to the Hub. */
export class HubPluginCommandService {
	private readonly workspaces = new Map<string, PluginCommandService>();
	private readonly pending = new Set<Promise<HubReplyEnvelope>>();
	private stopping = false;

	constructor(
		private readonly options: { workspaceRoot?: string; logger?: BasicLogger },
	) {}

	handleCommand(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope> {
		if (this.stopping)
			return Promise.resolve(
				errorReply(envelope, "hub_stopping", "Hub is stopping"),
			);
		const request = this.execute(envelope);
		this.pending.add(request);
		void request.then(
			() => this.pending.delete(request),
			() => this.pending.delete(request),
		);
		return request;
	}

	private async execute(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		try {
			const payload = envelope.payload;
			if (!payload) throw new Error("Plugin command requires a payload");
			if (envelope.command === "plugins.install") {
				if (typeof payload.source !== "string" || !payload.source.trim())
					throw new Error("Plugin install requires a source");
				if (payload.force !== undefined && typeof payload.force !== "boolean")
					throw new Error("Plugin install force must be a boolean");
				const result = await installPlugin({
					source: payload.source,
					force: payload.force === true,
				});
				return okReply(envelope, { result });
			}
			if (
				typeof payload.workspaceRoot !== "string" ||
				!payload.workspaceRoot.trim()
			)
				throw new Error("Plugin commands require a workspaceRoot");
			const workspaceRoot = resolve(
				this.options.workspaceRoot ?? process.cwd(),
				payload.workspaceRoot,
			);
			if (
				envelope.command === "plugins.commands.run" &&
				(typeof payload.name !== "string" ||
					!payload.name.trim() ||
					typeof payload.input !== "string")
			)
				throw new Error("Plugin command requires a name and string input");
			let service = this.workspaces.get(workspaceRoot);
			if (!service) {
				service = createPluginCommandService({
					cwd: workspaceRoot,
					workspacePath: workspaceRoot,
					logger: this.options.logger,
				});
				this.workspaces.set(workspaceRoot, service);
			}
			if (envelope.command === "plugins.commands.list")
				return okReply(envelope, { commands: await service.listCommands() });
			const result = await service.run(
				payload.name as string,
				payload.input as string,
			);
			return okReply(envelope, { handled: result !== undefined, result });
		} catch (error) {
			return errorReply(
				envelope,
				"plugin_command_failed",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	get activeRequestCount(): number {
		return this.pending.size;
	}

	async dispose(): Promise<void> {
		this.stopping = true;
		await Promise.allSettled(this.pending);
		await Promise.allSettled(
			[...this.workspaces.values()].map((service) => service.shutdown()),
		);
		this.workspaces.clear();
	}
}
