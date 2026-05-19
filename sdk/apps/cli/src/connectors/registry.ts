import type { ConnectCommandDefinition } from "./types";

type ConnectorRegistryEntry = {
	name: string;
	description: string;
	load: () => Promise<ConnectCommandDefinition>;
};

const registry = new Map<string, ConnectorRegistryEntry>([
	[
		"gchat",
		{
			name: "gchat",
			description: "Google Chat webhook bridge backed by RPC runtime sessions",
			load: async () => (await import("./adapters/gchat")).gchatConnector,
		},
	],
	[
		"linear",
		{
			name: "linear",
			description: "Linear webhook bridge backed by RPC runtime sessions",
			load: async () => (await import("./adapters/linear")).linearConnector,
		},
	],
	[
		"slack",
		{
			name: "slack",
			description: "Slack webhook bridge backed by RPC runtime sessions",
			load: async () => (await import("./adapters/slack")).slackConnector,
		},
	],
	[
		"telegram",
		{
			name: "telegram",
			description: "Bridge Telegram bot messages into RPC chat sessions",
			load: async () => (await import("./adapters/telegram")).telegramConnector,
		},
	],
	[
		"whatsapp",
		{
			name: "whatsapp",
			description: "Bridge WhatsApp webhook messages into RPC chat sessions",
			load: async () => (await import("./adapters/whatsapp")).whatsappConnector,
		},
	],
]);

export function listConnectors(): Array<
	Pick<ConnectorRegistryEntry, "name" | "description">
> {
	return [...registry.values()].map(({ name, description }) => ({
		name,
		description,
	}));
}

export async function getConnector(
	name: string,
): Promise<ConnectCommandDefinition | undefined> {
	const entry = registry.get(name.trim().toLowerCase());
	return entry ? entry.load() : undefined;
}
