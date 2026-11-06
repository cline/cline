"use client";

import { useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import type {
	DesktopHubStatus,
	DesktopTransportState,
} from "@/lib/desktop-transport";

/**
 * The sidecar sends `hub_status` whenever local Hub startup changes and
 * replays it to every new connection, so subscribing is enough.
 */
export function useHubStartup() {
	const [transport, setTransport] = useState<DesktopTransportState>(
		desktopClient.getTransportState(),
	);
	const [hub, setHub] = useState<DesktopHubStatus>({ state: "starting" });

	useEffect(
		() =>
			desktopClient.subscribeTransportState((next) => {
				setTransport(next);
				// A restarted sidecar replays its own status on connect; never reuse
				// the previous sidecar's "ready".
				if (next !== "connected") setHub({ state: "starting" });
			}),
		[],
	);
	useEffect(
		() =>
			desktopClient.subscribe("hub_status", (payload) => {
				if (payload && typeof payload === "object" && "state" in payload) {
					setHub(payload as DesktopHubStatus);
				}
			}),
		[],
	);

	return { transport, hub };
}
