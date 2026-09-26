"use client";

import { AgentWelcomeHero } from "@cline/ui";
import { useEffect, useRef, useState } from "react";
import type { useDesktopReadiness } from "@/hooks/use-desktop-readiness";

export function LoadingScreen({
	readiness,
	finishing = false,
	onComplete,
}: {
	readiness: ReturnType<typeof useDesktopReadiness>;
	finishing?: boolean;
	onComplete?: () => void;
}) {
	const connected = readiness.transport === "connected";
	const { hub, startup } = readiness;
	const failed =
		!readiness.retrying &&
		(connected
			? hub.state === "failed" && !hub.automaticRetry
			: startup?.state === "failed" ||
				(startup?.state !== "starting" &&
					readiness.transport === "unavailable"));
	const steps = [
		"Webview initialized",
		"Desktop backend connected",
		"Cline Hub discovered",
		"Connected to Cline Hub",
		"Session service ready",
	];
	const completed = !connected
		? 1
		: hub.state === "ready"
			? 5
			: hub.step === "sessions"
				? 4
				: hub.step === "connecting"
					? 3
					: 2;
	const [progress, setProgress] = useState(0);
	const finishDelay = useRef<number | null>(null);
	const status =
		connected && hub.state === "ready"
			? progress >= 99
				? "Cline is ready"
				: "Finishing up…"
			: readiness.retrying
				? "Retrying startup…"
				: failed
					? "Cline could not finish starting"
					: !connected
						? "Starting desktop backend…"
						: hub.automaticRetry
							? `Retrying session service automatically (attempt ${hub.attempt + 1})…`
							: hub.step === "connecting"
								? "Connecting to Cline Hub…"
								: hub.step === "sessions"
									? "Preparing session service…"
									: hub.step === "discovery"
										? "Discovering or starting Cline Hub…"
										: "Preparing local environment…";

	const target = finishing
		? 100
		: connected && hub.state === "ready"
			? 98
			: Math.round((completed / steps.length) * 90);
	useEffect(() => {
		if (!finishing) finishDelay.current = null;
		if (progress === target) return;
		if (finishing && progress >= 90 && finishDelay.current === null)
			finishDelay.current = 1000 / (100 - progress);
		const timer = setTimeout(
			() => setProgress((value) => value + Math.sign(target - value)),
			progress >= 90 ? (finishing ? (finishDelay.current ?? 100) : 500) : 50,
		);
		return () => clearTimeout(timer);
	}, [progress, target, finishing]);
	useEffect(() => {
		if (finishing && progress === 100) onComplete?.();
	}, [finishing, progress, onComplete]);

	return (
		<main
			className="fixed inset-0 z-100 flex flex-col justify-between overflow-auto bg-background font-sans text-foreground"
			aria-label="Starting Cline"
		>
			{/* Subtle grid backdrop to match the hero */}
			<div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
				{[...Array(8)].map((_, i) => (
					<div
						key={`h-${i}`}
						className="absolute h-px bg-foreground/10"
						style={{ top: `${12.5 * (i + 1)}%`, left: 0, right: 0 }}
					/>
				))}
				{[...Array(12)].map((_, i) => (
					<div
						key={`v-${i}`}
						className="absolute w-px bg-foreground/10"
						style={{ left: `${8.33 * (i + 1)}%`, top: 0, bottom: 0 }}
					/>
				))}
			</div>

			{/* Top row: progress counter */}
			<div className="relative z-10 flex items-center justify-end px-6 lg:px-12 pt-8">
				<span className="text-sm text-muted-foreground tabular-nums">
					{completed} / {steps.length}
				</span>
			</div>

			<div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
				<div className="w-full">
					<AgentWelcomeHero variant="bot-only" interactive={false} />
				</div>
				<h1 className="sr-only">
					{failed ? "Unable to start Cline" : "Starting Cline"}
				</h1>
			</div>

			{/* Bottom: progress bar */}
			<div className="relative z-10 px-6 lg:px-12 pb-10">
				<div className="flex items-baseline justify-between mb-4">
					<span
						role={failed ? "alert" : "status"}
						aria-live="polite"
						className="text-sm text-muted-foreground"
					>
						{status}
					</span>
					<span className="text-xs text-muted-foreground tabular-nums">
						{progress}%
					</span>
				</div>
				<progress
					className="sr-only"
					aria-label="Startup progress"
					value={completed}
					max={steps.length}
				/>
				<div
					aria-hidden="true"
					className="h-1 w-full overflow-hidden rounded-full bg-muted"
				>
					<div
						className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-100 motion-safe:ease-linear"
						style={{ width: `${progress}%` }}
					/>
				</div>
				{failed && (
					<div className="mt-4 text-sm">
						<p className="whitespace-pre-wrap text-muted-foreground">
							{readiness.retryError ??
								(connected ? hub.message : startup?.error)}
						</p>
						{!connected && startup?.exitStatus && <p>{startup.exitStatus}</p>}
						{!connected && !!startup?.diagnostics.length && (
							<details>
								<summary>Startup diagnostics</summary>
								<pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
									{startup.diagnostics.join("\n")}
								</pre>
							</details>
						)}
						<button
							type="button"
							onClick={() => void readiness.retry()}
							className="mt-3 rounded-md bg-primary px-4 py-2 text-primary-foreground"
						>
							Retry
						</button>
					</div>
				)}
			</div>
		</main>
	);
}
