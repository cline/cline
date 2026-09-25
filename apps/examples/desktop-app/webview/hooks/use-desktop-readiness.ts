"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";
import type {
	DesktopBackendReadiness,
	DesktopTransportState,
} from "@/lib/desktop-transport";

import {
	buildStartupReport,
	type StartupFailureSnapshot,
	sanitizeStartupLine,
} from "@/lib/startup-diagnostics";

export type DesktopStartupStatus = {
	attempt: number;
	elapsedMs: number;
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
	const startedAt = useRef(Date.now());
	const [failures, setFailures] = useState<StartupFailureSnapshot[]>([]);
	const lastSnapshot = useRef("");
	useEffect(() => {
		const failure = hub.lastFailure;
		let snapshot: StartupFailureSnapshot | undefined;
		if (transport === "connected" && (failure || hub.state === "failed")) {
			snapshot = {
				at: failure?.at ?? new Date().toISOString(),
				stage: "hub",
				elapsedMs: failure?.elapsedMs ?? Date.now() - startedAt.current,
				attempt: failure?.attempt ?? hub.attempt,
				step: failure?.stage ?? hub.step,
				code: failure?.code ?? "INITIALIZATION_FAILED",
				diagnostics: [],
			};
		} else if (
			transport !== "connected" &&
			(startup?.state === "failed" || transport === "unavailable")
		) {
			snapshot = {
				at: new Date().toISOString(),
				stage: "desktop_endpoint",
				elapsedMs: startup?.elapsedMs ?? Date.now() - startedAt.current,
				attempt: startup?.attempt,
				code: "DESKTOP_ENDPOINT_UNAVAILABLE",
				exitStatus: startup?.exitStatus
					? sanitizeStartupLine(startup.exitStatus)
					: null,
				diagnostics: [startup?.error, ...(startup?.diagnostics ?? [])]
					.filter((line): line is string => !!line)
					.slice(-32)
					.map(sanitizeStartupLine),
			};
		}
		if (!snapshot) return;
		// Polling an unchanged failure must not evict earlier attempts. A changed
		// diagnostic tail is retained, while retry/ready transitions never clear it.
		const key = JSON.stringify({
			...snapshot,
			at: failure?.at,
			elapsedMs: undefined,
		});
		if (key === lastSnapshot.current) return;
		lastSnapshot.current = key;
		const captured = snapshot;
		setFailures((previous) => [...previous, captured].slice(-8));
	}, [transport, startup, hub]);
	const diagnosticReport = failures.length
		? buildStartupReport(
				failures,
				typeof navigator === "undefined" ? "unknown" : navigator.platform,
			)
		: null;
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
						attempt: 0,
						elapsedMs: Date.now() - startedAt.current,
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
	return {
		transport,
		startup,
		hub,
		retry,
		retryError,
		retrying,
		diagnosticReport,
	};
}
