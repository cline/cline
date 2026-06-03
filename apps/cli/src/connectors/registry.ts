import { CONNECTOR_CATALOG, listConnectorCatalog } from "./catalog";
import type { ConnectCommandDefinition } from "./types";

type ConnectorRegistryEntry = {
	name: string;
	description: string;
	load: () => Promise<ConnectCommandDefinition>;
};

const connectorDescriptions = new Map(
	CONNECTOR_CATALOG.map((entry) => [entry.name, entry.description]),
);

const registry = new Map<string, ConnectorRegistryEntry>([
	[
		"agentphone",
		{
			name: "agentphone",
			description: connectorDescriptions.get("agentphone") ?? "AgentPhone",
			load: async () =>
				(await import("./adapters/agentphone")).agentPhoneConnector,
		},
	],
	[
		"discord",
		{
			name: "discord",
			description:
				"Discord interactions and gateway bridge backed by RPC runtime sessions",
			load: async () => (await import("./adapters/discord")).discordConnector,
		},
	],
	[
		"gchat",
		{
			name: "gchat",
			description: connectorDescriptions.get("gchat") ?? "Google Chat",
			load: async () => (await import("./adapters/gchat")).gchatConnector,
		},
	],
	[
		"linear",
		{
			name: "linear",
			description: connectorDescriptions.get("linear") ?? "Linear",
			load: async () => (await import("./adapters/linear")).linearConnector,
		},
	],
	[
		"slack",
		{
			name: "slack",
			description: connectorDescriptions.get("slack") ?? "Slack",
			load: async () => (await import("./adapters/slack")).slackConnector,
		},
	],
	[
		"telegram",
		{
			name: "telegram",
			description: connectorDescriptions.get("telegram") ?? "Telegram",
			load: async () => (await import("./adapters/telegram")).telegramConnector,
		},
	],
	[
		"whatsapp",
		{
			name: "whatsapp",
			description: connectorDescriptions.get("whatsapp") ?? "WhatsApp",
			load: async () => (await import("./adapters/whatsapp")).whatsappConnector,
		},
	],
]);

export function listConnectors(): Array<
	Pick<ConnectorRegistryEntry, "name" | "description">
> {
	return listConnectorCatalog();
}

export async function getConnector(
	name: string,
): Promise<ConnectCommandDefinition | undefined> {
	const entry = registry.get(name.trim().toLowerCase());
	return entry ? entry.load() : undefined;
}
