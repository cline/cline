"use client";

import { useCallback, useEffect, useState } from "react";
import { type BotSummary, fetchBots, subscribeToBotsChanged } from "@/lib/bots";

export type UseBotsResult = {
	bots: BotSummary[];
	botsLoaded: boolean;
	refreshBots: () => Promise<void>;
};

export function useBots(): UseBotsResult {
	const [bots, setBots] = useState<BotSummary[]>([]);
	const [botsLoaded, setBotsLoaded] = useState(false);

	const refreshBots = useCallback(async () => {
		try {
			setBots(await fetchBots());
		} catch {
			// Keep the last known roster on transient transport failures.
		} finally {
			setBotsLoaded(true);
		}
	}, []);

	useEffect(() => {
		void refreshBots();
		return subscribeToBotsChanged((nextBots) => {
			setBots(nextBots);
			setBotsLoaded(true);
		});
	}, [refreshBots]);

	return { bots, botsLoaded, refreshBots };
}
