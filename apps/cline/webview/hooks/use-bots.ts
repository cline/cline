"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

// Matches sandbox/bot-config.ts's DEFAULT_BOT_ID and main.rs's DEFAULT_BOT_ID/MAX_BOTS.
export const DEFAULT_BOT_ID = "cline";
const DEFAULT_BOT_NAME = "Cline";
export const MAX_BOTS = 5;

export interface BotSummary {
	id: string;
	name: string;
	/** Local filesystem path or URL to the bot's icon; unset falls back to
	 * the default Cline logo. */
	icon?: string;
}

interface BotRegistryState {
	bots: BotSummary[];
	activeBotId?: string;
}

async function syncDesktopBotPreferences(
	state: BotRegistryState,
): Promise<BotRegistryState> {
	if (!isTauriAvailable()) return state;
	return desktopClient.invoke<BotRegistryState>("sync_gateway_bots", {
		bots: state.bots,
	});
}

export interface UseBotsResult {
	bots: BotSummary[];
	activeBotId: string;
	canCreateBot: boolean;
	createBot: (
		name: string,
		initialProjectPath?: string,
		icon?: string,
		systemPrompt?: string,
	) => Promise<BotSummary>;
	switchBot: (botId: string) => Promise<void>;
}

const FALLBACK_BOT: BotSummary = { id: DEFAULT_BOT_ID, name: DEFAULT_BOT_NAME };

/**
 * Owns the top-level bot registry exposed by the active host transport. In a
 * browser that is the remote Gateway; in Tauri it is the desktop host. The
 * seeded default only covers the interval before the authoritative response
 * lands, because arbitrary components may issue commands as soon as they
 * mount.
 */
export function useBotRegistry(): UseBotsResult {
	const [bots, setBots] = useState<BotSummary[]>([FALLBACK_BOT]);
	const [activeBotId, setActiveBotId] = useState<string>(DEFAULT_BOT_ID);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		void desktopClient
			.invoke<BotRegistryState>("get_bots_state")
			.then(syncDesktopBotPreferences)
			.then((state) => {
				if (cancelled) return;
				setBots(state.bots);
				setActiveBotId((current) => {
					const requested = state.activeBotId ?? current;
					return state.bots.some((bot) => bot.id === requested)
						? requested
						: (state.bots[0]?.id ?? DEFAULT_BOT_ID);
				});
			})
			.catch(() => {
				// Keep the seeded single-bot fallback through a transient
				// transport failure rather than surfacing an error for a
				// background bootstrap fetch.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const createBot = useCallback(
		async (
			name: string,
			initialProjectPath?: string,
			icon?: string,
			systemPrompt?: string,
		): Promise<BotSummary> => {
			const created = await desktopClient.invoke<BotSummary>("create_bot", {
				name,
				initialProjectPath: initialProjectPath?.trim() || undefined,
				icon: icon?.trim() || undefined,
				systemPrompt: systemPrompt?.trim() || undefined,
			});
			let nextBots = [...bots, created];
			if (isTauriAvailable()) {
				const synced = await desktopClient.invoke<BotRegistryState>(
					"sync_gateway_bots",
					{
						bots: nextBots.map((bot) =>
							bot.id === created.id && icon?.trim()
								? { ...bot, icon: icon.trim() }
								: bot,
						),
					},
				);
				nextBots = synced.bots;
				const projectPath = initialProjectPath?.trim();
				if (projectPath) {
					await desktopClient.invoke("assign_project", {
						botId: created.id,
						path: projectPath,
					});
				}
			}
			// Switching here (rather than leaving it to the caller) means
			// createBot always leaves the registry and the active id in
			// sync in one call - the same reason switchWorkspace adopts
			// assign_project's returned path instead of trusting its own input.
			await desktopClient.invoke<string>("switch_active_bot", {
				botId: created.id,
			});
			if (isTauriAvailable()) {
				await desktopClient.invoke<string>("switch_active_bot_preference", {
					botId: created.id,
				});
			}
			if (mountedRef.current) {
				setBots(nextBots);
				setActiveBotId(created.id);
			}
			return created;
		},
		[bots],
	);

	const switchBot = useCallback(
		async (botId: string): Promise<void> => {
			if (botId === activeBotId) {
				return;
			}
			await desktopClient.invoke<string>("switch_active_bot", { botId });
			if (isTauriAvailable()) {
				await desktopClient.invoke<string>("switch_active_bot_preference", {
					botId,
				});
			}
			if (mountedRef.current) {
				setActiveBotId(botId);
			}
		},
		[activeBotId],
	);

	return {
		bots,
		activeBotId,
		canCreateBot: bots.length < MAX_BOTS,
		createBot,
		switchBot,
	};
}
