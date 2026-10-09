"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";
import type {
	DesktopBackendReadiness,
	DesktopTransportState,
} from "@/lib/desktop-transport";

export type DesktopStartupStatus = {
	state: "starting" | "ready" | "failed";
	diagnostics: string[];
	exitStatus: string | null;
	error: string | null;
};

export function useDesktopReadiness() {
	const [transport, setTransport] = useState<DesktopTransportState>(
		desktopClient.getTransportState(),
	);
	const [startup, setStartup] = useState<DesktopStartupStatus | null>(null);
	const [hub, setHub] = useState<DesktopBackendReadiness>({
		state: "starting",
		attempt: 0,
	});
	const [retryError, setRetryError] = useState<string | null>(null);
	const [retrying, setRetrying] = useState(false);
	const hubEventRevision = useRef(0);
	useEffect(
		() =>
			desktopClient.subscribeTransportState((next) => {
				if (next !== "connected") {
					hubEventRevision.current += 1;
					setHub({ state: "starting", attempt: 0 });
				}
				setTransport(next);
			}),
		[],
	);
	useEffect(() => {
		if (!isTauriAvailable() || transport === "connected") return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				const status = await desktopClient.invoke<DesktopStartupStatus>(
					"get_desktop_backend_status",
				);
				if (!cancelled) setStartup(status);
			} catch (error) {
				if (!cancelled)
					setStartup({
						state: "failed",
						diagnostics: [],
						exitStatus: null,
						error: String(error),
					});
			}
			if (!cancelled) timer = setTimeout(poll, 1000);
		};
		void poll();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [transport]);
	useEffect(() => {
		if (transport !== "connected") return;
		let cancelled = false;
		let eventReceived = false;
		const unsubscribe = desktopClient.subscribe(
			"backend_readiness",
			(payload) => {
				eventReceived = true;
				hubEventRevision.current += 1;
				setHub(payload as DesktopBackendReadiness);
			},
		);
		void desktopClient
			.invoke<DesktopBackendReadiness>("get_backend_readiness")
			.then((status) => {
				if (!cancelled && !eventReceived) setHub(status);
			})
			.catch((error) => {
				if (!cancelled && !eventReceived)
					setHub({ state: "failed", attempt: 0, message: String(error) });
			});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [transport]);
	const retry = useCallback(async () => {
		setRetrying(true);
		setRetryError(null);
		try {
			if (transport !== "connected") {
				setStartup(null);
				await desktopClient.retryConnection();
			} else {
				const revision = hubEventRevision.current;
				const status = await desktopClient.invoke<DesktopBackendReadiness>(
					"retry_backend_initialization",
				);
				if (revision === hubEventRevision.current) setHub(status);
			}
		} catch (error) {
			setRetryError(error instanceof Error ? error.message : String(error));
		} finally {
			setRetrying(false);
		}
	}, [transport]);
	return { transport, startup, hub, retry, retryError, retrying };
}
