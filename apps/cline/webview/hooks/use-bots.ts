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
	activeBotId: string;
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
 * Owns the top-level bot registry (host-owned, see main.rs's
 * get_bots_state/create_bot/switch_active_bot - never webview localStorage,
 * for the same reason the assigned-projects list isn't sourced from it
 * either). Seeded with the single default bot before the first real
 * response lands, matching desktopClient's own bootstrap default - there's
 * no reliable effect ordering to lean on instead, since arbitrary
 * components can issue commands as soon as they mount.
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
		if (!isTauriAvailable()) {
			return;
		}
		let cancelled = false;
		void desktopClient
			.invoke<BotRegistryState>("get_bots_state")
			.then((state) => {
				if (cancelled) return;
				setBots(state.bots);
				setActiveBotId(state.activeBotId);
			})
			.catch(() => {
				// Outside Tauri, or a transient failure - keep the seeded
				// single-bot fallback rather than surfacing an error for a
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
			if (!isTauriAvailable()) {
				throw new Error("Bots are only available in the desktop app.");
			}
			const created = await desktopClient.invoke<BotSummary>("create_bot", {
				name,
				initialProjectPath: initialProjectPath?.trim() || undefined,
				icon: icon?.trim() || undefined,
				systemPrompt: systemPrompt?.trim() || undefined,
			});
			// Switching here (rather than leaving it to the caller) means
			// createBot always leaves the registry and the active id in
			// sync in one call - the same reason switchWorkspace adopts
			// assign_project's returned path instead of trusting its own input.
			await desktopClient.invoke<string>("switch_active_bot", {
				botId: created.id,
			});
			if (mountedRef.current) {
				setBots((current) => [...current, created]);
				setActiveBotId(created.id);
			}
			return created;
		},
		[],
	);

	const switchBot = useCallback(
		async (botId: string): Promise<void> => {
			if (botId === activeBotId) {
				return;
			}
			if (!isTauriAvailable()) {
				throw new Error("Bots are only available in the desktop app.");
			}
			await desktopClient.invoke<string>("switch_active_bot", { botId });
			if (mountedRef.current) {
				setActiveBotId(botId);
			}
		},
		[activeBotId],
	);

	return {
		bots,
		activeBotId,
		canCreateBot: isTauriAvailable() && bots.length < MAX_BOTS,
		createBot,
		switchBot,
	};
}
