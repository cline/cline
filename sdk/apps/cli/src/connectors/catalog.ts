export type ConnectorCatalogEntry = {
	name: string;
	description: string;
};

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
	{
		name: "discord",
		description:
			"Discord interactions and gateway bridge backed by RPC runtime sessions",
	},
	{
		name: "gchat",
		description: "Google Chat webhook bridge backed by RPC runtime sessions",
	},
	{
		name: "linear",
		description: "Linear webhook bridge backed by RPC runtime sessions",
	},
	{
		name: "slack",
		description: "Slack webhook bridge backed by RPC runtime sessions",
	},
	{
		name: "telegram",
		description: "Bridge Telegram bot messages into RPC chat sessions",
	},
	{
		name: "whatsapp",
		description: "Bridge WhatsApp webhook messages into RPC chat sessions",
	},
];

export function listConnectorCatalog(): ConnectorCatalogEntry[] {
	return CONNECTOR_CATALOG.map((entry) => ({ ...entry }));
}
