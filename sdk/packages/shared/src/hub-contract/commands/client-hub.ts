import { z } from "zod";
import {
	defineHubCommands,
	hubEmptyInput,
	hubObject,
	hubRecord,
} from "../define";

/** ClientCapability as advertised by clients (see hub.ts ClientCapability). */
const clientCapability = hubObject({
	// The Hub stores register capabilities verbatim and never rejects a missing
	// name, so it stays optional here even though the TS type requires it.
	name: z.string().optional(),
	description: z.string().optional(),
	scopes: z.array(z.string()).optional(),
	payloadSchema: hubRecord.optional(),
});

const workspaceContext = hubObject({
	workspaceRoot: z.string().nullish(),
	cwd: z.string().nullish(),
});

/** Shared by settings.list and settings.toggle (parseSettingsListInput). */
const settingsListShape = {
	cwd: z.string().optional(),
	workspaceRoot: z.string().optional(),
	agentPluginPaths: z.array(z.string()).optional(),
	includePluginTools: z.boolean().optional(),
	// BuiltinToolAvailabilityContext; the handler ignores non-object values.
	availabilityContext: z.unknown().optional(),
};

const settingsType = z.enum([
	"skills",
	"workflows",
	"rules",
	"plugins",
	"tools",
	"mcp",
]);

const hubStatusOutput = hubObject({
	hubId: z.string().optional(),
	draining: z.boolean().optional(),
	activeRpcTurns: z.number().optional(),
	pendingRuns: z.number().optional(),
	eventLog: hubObject({ lastSequence: z.number().optional() }).optional(),
	idle: z.boolean().optional(),
});

const connectorChannelsOutput = hubObject({
	available: z.array(hubRecord).optional(),
	active: z.array(hubRecord).optional(),
	configured: z.array(hubRecord).optional(),
});

/** connector.start / connector.stop target (parseInstanceTarget). */
const connectorInstanceShape = {
	channel: z.string().min(1),
	instanceId: z.string().min(1),
};

export const clientHubCommands = defineHubCommands({
	"client.register": {
		description:
			"Register the connection's client (identity, capabilities, workspace) with the Hub.",
		input: hubObject({
			// Falls back to envelope.clientId, then a generated id.
			clientId: z.string().optional(),
			clientType: z.string().optional(),
			displayName: z.string().optional(),
			// TODO(contract): HubActorKind ("client" | "peerHub"); not enforced by the handler.
			actorKind: z.string().optional(),
			// TODO(contract): HubTransportKind; not enforced by the handler.
			transport: z.string().optional(),
			capabilities: z.array(clientCapability).optional(),
			metadata: hubRecord.optional(),
			workspaceContext: workspaceContext.nullish(),
			protocolVersion: z.string().optional(),
		}),
		output: hubObject({ clientId: z.string().optional() }),
	},
	"client.update": {
		description:
			"Update the registered client's metadata and/or capabilities (client from envelope.clientId).",
		input: hubObject({
			// Non-object values are ignored.
			metadata: hubRecord.nullish(),
			// Malformed entries (non-objects, missing name) are silently dropped by
			// the handler, so entries are not validated here.
			capabilities: z.array(z.unknown()).nullish(),
		}),
	},
	"client.unregister": {
		description: "Unregister the client named by envelope.clientId.",
		input: hubEmptyInput,
	},
	"client.list": {
		description: "List clients registered with the Hub.",
		input: hubEmptyInput,
		output: hubObject({ clients: z.array(hubRecord).optional() }),
	},
	"cline.account.get_current": {
		// TODO(contract): declared in HubCommandName but no Hub handler or sender exists.
		description:
			"Get the current Cline account (reserved; not handled by the Hub).",
		input: hubRecord,
	},
	"prompt_commands.list": {
		// TODO(contract): declared in HubCommandName but no Hub handler or sender exists.
		description:
			"List prompt (slash) commands (reserved; not handled by the Hub).",
		input: hubRecord,
	},
	"prompt_commands.execute": {
		// TODO(contract): declared in HubCommandName but no Hub handler or sender exists.
		description: "Execute a prompt command (reserved; not handled by the Hub).",
		input: hubRecord,
	},
	"mention_files.search": {
		// TODO(contract): declared in HubCommandName but no Hub handler or sender exists.
		description:
			"Search files for @-mentions (reserved; not handled by the Hub).",
		input: hubRecord,
	},
	"catalog.list": {
		// TODO(contract): declared in HubCommandName but no Hub handler or sender exists.
		description: "List catalog entries (reserved; not handled by the Hub).",
		input: hubRecord,
	},
	"hub.drain": {
		description:
			"Enter (default) or leave drain mode, refusing new mutating work while runs finish.",
		input: hubObject({
			// TODO(contract): handler treats anything but `false` as true.
			draining: z.boolean().nullish(),
			// Non-string reasons are ignored by the handler.
			reason: z.string().nullish(),
		}),
		output: hubStatusOutput,
	},
	"hub.status": {
		description: "Report the Hub's drain state and activity.",
		input: hubEmptyInput,
		output: hubStatusOutput,
	},
	"settings.list": {
		description:
			"List skills, workflows, rules, plugins, tools, and MCP settings for a workspace.",
		input: hubObject(settingsListShape),
		output: hubObject({ snapshot: hubRecord.optional() }),
	},
	"settings.get": {
		description: "Get a settings value (not implemented yet).",
		input: hubRecord,
	},
	"settings.patch": {
		description: "Patch settings values (not implemented yet).",
		input: hubRecord,
	},
	"settings.toggle": {
		description:
			"Enable or disable a skill, workflow, rule, plugin, tool, or MCP server.",
		input: hubObject({
			...settingsListShape,
			type: settingsType,
			id: z.string().optional(),
			path: z.string().optional(),
			name: z.string().optional(),
			enabled: z.boolean().optional(),
		}),
		output: hubObject({
			snapshot: hubRecord.optional(),
			changedTypes: z.array(z.string()).optional(),
		}),
	},
	"connector.channels": {
		description: "List available, active, and configured connector channels.",
		input: hubEmptyInput,
		output: connectorChannelsOutput,
	},
	"connector.configure": {
		description:
			"Save a connector channel's field values and security settings.",
		input: hubObject({
			channel: z.string().min(1),
			// Non-string entries are dropped; a non-object is treated as {}.
			values: hubRecord.nullish(),
			security: hubObject({
				enabled: z.boolean().optional(),
				values: hubRecord.nullish(),
			}).nullish(),
		}),
		output: connectorChannelsOutput,
	},
	"connector.delete_config": {
		description: "Delete a connector channel's saved configuration.",
		input: hubObject({ channel: z.string().min(1) }),
		output: connectorChannelsOutput,
	},
	"connector.start": {
		description: "Start (or restart) a Hub-supervised connector instance.",
		input: hubObject({
			...connectorInstanceShape,
			// Non-string entries are dropped by the handler.
			args: z.array(z.string()).nullish(),
			restart: z.boolean().optional(),
		}),
		output: hubObject({
			started: z.boolean().optional(),
			record: hubRecord.optional(),
			reason: z.string().optional(),
		}),
	},
	"connector.stop": {
		description: "Stop a Hub-supervised connector instance.",
		input: hubObject({
			...connectorInstanceShape,
			// Defaults to true; only an explicit false keeps autostart.
			disableAutostart: z.boolean().optional(),
		}),
		output: hubObject({
			stopped: z.boolean().optional(),
			channel: z.string().optional(),
			instanceId: z.string().optional(),
		}),
	},
	"connector.supervised": {
		description: "List connector instances supervised by the Hub.",
		input: hubEmptyInput,
		output: hubObject({ supervised: z.array(hubRecord).optional() }),
	},
	"ui.notify": {
		description:
			"Broadcast a ui.notify event (payload forwarded verbatim) to subscribers.",
		input: hubObject({
			// HubUINotifyPayload types title/body as required, but the Hub forwards
			// the payload without checking it.
			title: z.string().optional(),
			body: z.string().optional(),
			// TODO(contract): "info" | "warning" | "error" per HubUINotifyPayload.
			severity: z.string().optional(),
			sessionId: z.string().optional(),
			clientId: z.string().optional(),
		}),
	},
	"ui.show_window": {
		description:
			"Broadcast a ui.show_window event (payload forwarded verbatim) to subscribers.",
		input: hubObject({
			windowId: z.string().optional(),
			focus: z.boolean().optional(),
		}),
	},
});
