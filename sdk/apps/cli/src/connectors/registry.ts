import { gchatConnector } from "./adapters/gchat";
import { slackConnector } from "./adapters/slack";
import { telegramConnector } from "./adapters/telegram";
import { whatsappConnector } from "./adapters/whatsapp";
import type { ConnectCommandDefinition } from "./types";

const registry = new Map<string, ConnectCommandDefinition>([
	[gchatConnector.name, gchatConnector],
	[slackConnector.name, slackConnector],
	[telegramConnector.name, telegramConnector],
	[whatsappConnector.name, whatsappConnector],
]);

export function listConnectors(): ConnectCommandDefinition[] {
	return [...registry.values()];
}

export function getConnector(
	name: string,
): ConnectCommandDefinition | undefined {
	return registry.get(name.trim().toLowerCase());
}
