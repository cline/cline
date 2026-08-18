import { desktopClient } from "@/lib/desktop-client";

export const BOT_SHAPES = [
	"circle",
	"square",
	"triangle",
	"diamond",
	"hexagon",
	"star",
] as const;

export type BotShape = (typeof BOT_SHAPES)[number];

export const BOT_COLORS = [
	"#8b5cf6", // violet
	"#3b82f6", // blue
	"#06b6d4", // cyan
	"#10b981", // emerald
	"#f59e0b", // amber
	"#f97316", // orange
	"#ef4444", // red
	"#ec4899", // pink
] as const;

export type BotSummary = {
	id: string;
	name: string;
	shape: BotShape;
	color: string;
	provider?: string;
	model?: string;
	sessionId?: string;
	createdAt: string;
	updatedAt: string;
	memoryPreview: string;
	hasMemory: boolean;
};

export const BOTS_CHANGED_EVENT = "bots_changed";

export async function fetchBots(): Promise<BotSummary[]> {
	const bots = await desktopClient.invoke<BotSummary[]>("list_bots");
	return Array.isArray(bots) ? bots : [];
}

export async function createBot(input: {
	name: string;
	shape: BotShape;
	color: string;
	provider?: string;
	model?: string;
}): Promise<BotSummary> {
	return await desktopClient.invoke<BotSummary>("create_bot", input);
}

export async function updateBot(
	botId: string,
	patch: { name?: string; shape?: BotShape; color?: string },
): Promise<BotSummary> {
	return await desktopClient.invoke<BotSummary>("update_bot", {
		botId,
		...patch,
	});
}

export async function deleteBot(botId: string): Promise<boolean> {
	return await desktopClient.invoke<boolean>("delete_bot", { botId });
}

export async function readBotMemory(botId: string): Promise<string> {
	const payload = await desktopClient.invoke<{ memory?: string }>(
		"read_bot_memory",
		{ botId },
	);
	return typeof payload?.memory === "string" ? payload.memory : "";
}

export async function updateBotMemory(
	botId: string,
	memory: string,
): Promise<void> {
	await desktopClient.invoke("update_bot_memory", { botId, memory });
}

export function subscribeToBotsChanged(
	listener: (bots: BotSummary[]) => void,
): () => void {
	return desktopClient.subscribe(BOTS_CHANGED_EVENT, (payload) => {
		const bots = (payload as { bots?: unknown })?.bots;
		if (Array.isArray(bots)) {
			listener(bots as BotSummary[]);
		}
	});
}

export function botThreadId(botId: string): string {
	return `bot_${botId}`;
}
