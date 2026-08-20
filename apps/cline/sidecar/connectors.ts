import {
	connectorChannelsFromPlatforms,
	type ConnectorChannelsResponse,
} from "@cline/shared";
import type { BotId, ConnectorId } from "@cline/shared/gateway";
import { resolveGatewayPaths, writeSecretFile } from "@cline/gateway";
import type { SidecarContext } from "./types";

type RecordValue = Record<string, unknown>;

function strings(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
	);
}

async function defaultBotId(ctx: SidecarContext): Promise<BotId> {
	const { bots } = await ctx.client.listBots();
	const botId = bots[0]?.identity.botId;
	if (!botId) throw new Error("No Gateway bot is configured");
	return botId;
}

export async function connectorChannels(ctx: SidecarContext): Promise<ConnectorChannelsResponse> {
	const [listed, status] = await Promise.all([
		ctx.client.listConnectors(),
		ctx.client.getStatus(),
	]);
	const supported = new Set(["slack", "telegram"]);
	return {
		available: connectorChannelsFromPlatforms().filter((channel) => supported.has(channel.id)),
		active: listed.connectors
			.filter((connector) => connector.status === "enabled")
			.map((connector) => ({
				id: connector.connectorId,
				type: connector.kind,
				instanceId: status.instanceId,
				pid: status.pid,
				hubUrl: `gateway://${status.namespace}`,
				startedAt: new Date(connector.createdAt).toISOString(),
			})),
		configured: listed.connectors.map((connector) => ({
			id: connector.connectorId,
			type: connector.kind,
			configuredAt: new Date(connector.createdAt).toISOString(),
			updatedAt: new Date(connector.createdAt).toISOString(),
		})),
	};
}

export async function startConnectorChannel(
	ctx: SidecarContext,
	args: RecordValue,
): Promise<ConnectorChannelsResponse> {
	const kind = String(args.channel ?? "");
	if (kind !== "slack" && kind !== "telegram") throw new Error(`Unsupported Gateway connector: ${kind}`);
	const values = strings(args.values);
	const security = args.security && typeof args.security === "object" ? args.security as RecordValue : {};
	const securityValues = strings(security.values);
	const botId = await defaultBotId(ctx);
	const existing = (await ctx.client.listConnectors({ botId })).connectors.find((connector) => connector.kind === kind);
	if (existing) await ctx.client.mutate("connector.remove", { connectorId: existing.connectorId });

	const secretName = `desktop-${botId}-${kind}`;
	const credential = kind === "telegram"
		? values["-k"]?.trim()
		: JSON.stringify({
				botToken: values["--bot-token"]?.trim(),
				appToken: values["--app-token"]?.trim(),
			});
	if (!credential || (kind === "slack" && (!values["--bot-token"]?.trim() || !values["--app-token"]?.trim()))) {
		throw new Error(kind === "telegram" ? "Bot token is required" : "Bot token and app-level token are required");
	}
	writeSecretFile(resolveGatewayPaths({ namespace: process.env.CLINE_GATEWAY_NAMESPACE?.trim() || "desktop" }), secretName, credential);
	await ctx.client.registerConnector({
		botId,
		kind,
		name: `${kind}-${botId}`,
		credentialRef: secretName,
		config: security.enabled === true
			? kind === "telegram"
				? { allowedUserId: securityValues.userId }
				: { allowedTeamId: securityValues.teamId, allowedUserId: securityValues.userId }
			: {},
	});
	return connectorChannels(ctx);
}

export async function stopConnectorChannel(
	ctx: SidecarContext,
	args: RecordValue,
): Promise<ConnectorChannelsResponse> {
	const kind = String(args.channel ?? "");
	const botId = await defaultBotId(ctx);
	const existing = (await ctx.client.listConnectors({ botId })).connectors.find((connector) => connector.kind === kind);
	if (existing) await ctx.client.mutate("connector.remove", { connectorId: existing.connectorId as ConnectorId });
	return connectorChannels(ctx);
}
