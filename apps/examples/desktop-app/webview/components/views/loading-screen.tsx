"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import type {
	DesktopBootstrapPhase,
	DesktopBootstrapStatus,
	DesktopTransportState,
} from "@/lib/desktop-transport";
import { cn } from "@/lib/utils";
import { AuroraBackground } from "../ui/aurora-bg";

const BOOT_STEPS: ReadonlyArray<{
	phase: Exclude<DesktopBootstrapPhase, "error">;
	text: string;
}> = [
	{ phase: "starting_sidecar", text: "Starting desktop sidecar" },
	{ phase: "starting_hub", text: "Starting Cline Hub" },
	{ phase: "connecting_core", text: "Connecting Cline runtime" },
	{ phase: "connecting_event_client", text: "Connecting Hub event stream" },
	{ phase: "ready", text: "Ready" },
];

const INITIAL_STATUS: DesktopBootstrapStatus = {
	phase: "starting_sidecar",
	revision: 0,
	updatedAt: new Date(0).toISOString(),
};

const MIN_VISIBLE_MS = 2_000;
const FADE_DURATION_MS = 500;
const STEP_REVEAL_MS = 350;

function isBootstrapStatus(value: unknown): value is DesktopBootstrapStatus {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { phase?: unknown; revision?: unknown };
	const phase = candidate.phase;
	return (
		typeof phase === "string" &&
		typeof candidate.revision === "number" &&
		[
			"starting_sidecar",
			"starting_hub",
			"connecting_core",
			"connecting_event_client",
			"ready",
			"error",
		].includes(phase)
	);
}

export function LoadingScreen({ onComplete }: { onComplete?: () => void }) {
	const [bootstrapStatus, setBootstrapStatus] =
		useState<DesktopBootstrapStatus>(INITIAL_STATUS);
	const [transportState, setTransportState] = useState<DesktopTransportState>(
		desktopClient.getTransportState(),
	);
	const [transportError, setTransportError] = useState<string | null>(null);
	const [retrying, setRetrying] = useState(false);
	const [done, setDone] = useState(false);
	const [displayedStepIndex, setDisplayedStepIndex] = useState(0);
	const mountedAtRef = useRef(Date.now());
	const onCompleteRef = useRef(onComplete);
	onCompleteRef.current = onComplete;

	useEffect(() => {
		let active = true;
		const applyStatus = (payload: unknown) => {
			if (active && isBootstrapStatus(payload)) {
				setBootstrapStatus((current) =>
					payload.revision >= current.revision ? payload : current,
				);
			}
		};
		const unsubscribeStatus = desktopClient.subscribe(
			"bootstrap_status",
			applyStatus,
		);
		const unsubscribeTransport = desktopClient.subscribeTransportState(
			(state) => {
				if (!active) return;
				setTransportState(state);
				setTransportError(desktopClient.getTransportError());
			},
		);

		void desktopClient
			.invoke<DesktopBootstrapStatus>("get_bootstrap_status")
			.then(applyStatus)
			.catch(() => {
				if (active) setTransportError(desktopClient.getTransportError());
			});

		return () => {
			active = false;
			unsubscribeStatus();
			unsubscribeTransport();
		};
	}, []);

	const targetPhase =
		bootstrapStatus.phase === "error"
			? (bootstrapStatus.failedPhase ?? "starting_hub")
			: bootstrapStatus.phase;
	const targetStepIndex = Math.max(
		0,
		BOOT_STEPS.findIndex((step) => step.phase === targetPhase),
	);
	const activeIndex = Math.min(displayedStepIndex, targetStepIndex);
	const readyIsVisible =
		bootstrapStatus.phase === "ready" && activeIndex === BOOT_STEPS.length - 1;

	useEffect(() => {
		if (displayedStepIndex > targetStepIndex) {
			setDisplayedStepIndex(targetStepIndex);
			return;
		}
		if (displayedStepIndex === targetStepIndex) return;

		const timeout = setTimeout(() => {
			setDisplayedStepIndex((current) =>
				Math.min(current + 1, targetStepIndex),
			);
		}, STEP_REVEAL_MS);
		return () => clearTimeout(timeout);
	}, [displayedStepIndex, targetStepIndex]);

	useEffect(() => {
		if (!readyIsVisible) return;

		const elapsedMs = Date.now() - mountedAtRef.current;
		const remainingVisibleMs = Math.max(0, MIN_VISIBLE_MS - elapsedMs);
		let completionTimeout: ReturnType<typeof setTimeout> | undefined;
		const fadeTimeout = setTimeout(() => {
			setDone(true);
			completionTimeout = setTimeout(
				() => onCompleteRef.current?.(),
				FADE_DURATION_MS,
			);
		}, remainingVisibleMs);

		return () => {
			clearTimeout(fadeTimeout);
			if (completionTimeout) clearTimeout(completionTimeout);
		};
	}, [readyIsVisible]);

	const retry = useCallback(async () => {
		setRetrying(true);
		setTransportError(null);
		try {
			const command =
				bootstrapStatus.phase === "error"
					? "retry_bootstrap"
					: "get_bootstrap_status";
			const status =
				await desktopClient.invoke<DesktopBootstrapStatus>(command);
			if (isBootstrapStatus(status)) {
				setBootstrapStatus((current) =>
					status.revision >= current.revision ? status : current,
				);
			}
		} catch {
			setTransportError(
				desktopClient.getTransportError() ?? "Desktop backend is unavailable",
			);
		} finally {
			setRetrying(false);
		}
	}, [bootstrapStatus.phase]);

	const errorMessage =
		bootstrapStatus.phase === "error" && activeIndex === targetStepIndex
			? (bootstrapStatus.message ?? "Cline Hub failed to start")
			: transportState === "unavailable"
				? (transportError ?? "Desktop backend is unavailable")
				: null;
	const progress = readyIsVisible
		? 100
		: Math.round((activeIndex / (BOOT_STEPS.length - 1)) * 100);

	return (
		<div
			className={cn(
				"fixed inset-0 z-100 flex items-center justify-center bg-background transition-opacity duration-500",
				done ? "pointer-events-none opacity-0" : "opacity-100",
			)}
		>
			<AuroraBackground />
			<div className="pointer-events-none absolute inset-0 overflow-hidden">
				<div className="absolute left-1/2 top-1/2 h-100 w-100 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
			</div>

			<div className="relative w-full max-w-md px-6">
				<div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
					<div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
						<span className="h-3 w-3 rounded-full bg-destructive/70" />
						<span className="h-3 w-3 rounded-full bg-chart-3/70" />
						<span className="h-3 w-3 rounded-full bg-primary/70" />
						<span className="ml-2 font-mono text-xs text-muted-foreground">
							{errorMessage ? "startup failed" : "starting cline code"}
						</span>
					</div>

					<div className="min-h-55 px-4 py-4 font-mono text-sm leading-relaxed">
						<div className="flex items-center gap-2 py-0.5 text-foreground">
							<span className="text-primary">❯</span>
							<span>cline code --boot</span>
						</div>
						{BOOT_STEPS.map((step, index) => {
							const isFailed = Boolean(errorMessage) && index === activeIndex;
							const isComplete =
								index < activeIndex ||
								(readyIsVisible && index === activeIndex);
							const isActive =
								!errorMessage && index === activeIndex && !isComplete;

							return (
								<div
									className={cn(
										"flex items-center justify-between gap-4 py-0.5",
										index > activeIndex && "opacity-35",
									)}
									key={step.phase}
								>
									<span className="flex items-baseline gap-2 text-muted-foreground">
										<span>·</span>
										<span>{step.text}</span>
										{isActive ? (
											<span className="inline-block h-4 w-2 animate-pulse bg-primary" />
										) : null}
									</span>
									{isComplete ? (
										<span className="shrink-0 text-xs text-primary">
											{step.phase === "ready" ? "ready" : "done"}
										</span>
									) : isFailed ? (
										<span className="shrink-0 text-xs text-destructive">
											failed
										</span>
									) : null}
								</div>
							);
						})}

						{errorMessage ? (
							<div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
								<p className="wrap-break-word">{errorMessage}</p>
								<button
									className="mt-2 rounded border border-destructive/40 px-2.5 py-1 text-foreground hover:bg-destructive/10 disabled:opacity-50"
									disabled={retrying}
									onClick={() => void retry()}
									type="button"
								>
									{retrying ? "Retrying…" : "Retry"}
								</button>
							</div>
						) : null}
					</div>

					<div className="border-t border-border px-4 py-3">
						<div className="mb-1.5 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
							<span>{errorMessage ? "blocked" : "starting"}</span>
							<span>{progress}%</span>
						</div>
						<div className="h-1 w-full overflow-hidden rounded-full bg-muted">
							<div
								className={cn(
									"h-full rounded-full transition-all duration-300 ease-out",
									errorMessage ? "bg-destructive" : "bg-primary",
								)}
								style={{ width: `${progress}%` }}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
