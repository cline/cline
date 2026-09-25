"use client";

import { AgentWelcomeHero } from "@cline/ui";
import type { useDesktopReadiness } from "@/hooks/use-desktop-readiness";

const STEP_COUNT = 5;

export function LoadingScreen({
	readiness,
	onContinue,
}: {
	readiness: ReturnType<typeof useDesktopReadiness>;
	onContinue?: () => void;
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
	// Webview mounted → backend connected → hub discovered → hub connected → sessions ready.
	const completed = !connected
		? 1
		: hub.state === "ready"
			? 5
			: hub.step === "sessions"
				? 4
				: hub.step === "connecting"
					? 3
					: 2;
	const status = readiness.retrying
		? "Retrying startup…"
		: failed
			? "Cline could not finish starting"
			: !connected
				? "Starting desktop backend…"
				: hub.state === "ready"
					? "Cline is ready"
					: hub.automaticRetry
						? `Retrying session service (attempt ${hub.attempt + 1})…`
						: hub.step === "connecting"
							? "Connecting to Cline Hub…"
							: hub.step === "sessions"
								? "Preparing session service…"
								: hub.step === "discovery"
									? "Discovering or starting Cline Hub…"
									: "Preparing local environment…";

	return (
		<main
			className="fixed inset-0 z-100 flex flex-col items-center justify-center gap-8 overflow-auto bg-background p-6 font-sans text-foreground"
			aria-label="Starting Cline"
		>
			<div className="w-full">
				<AgentWelcomeHero variant="bot-only" interactive={false} />
			</div>
			<h1 className="sr-only">
				{failed ? "Unable to start Cline" : "Starting Cline"}
			</h1>

			<div className="flex w-full max-w-sm flex-col items-center gap-3">
				<span
					role={failed ? "alert" : "status"}
					aria-live="polite"
					className="text-sm text-muted-foreground"
				>
					{status}
				</span>
				<progress
					className="sr-only"
					aria-label="Startup progress"
					value={completed}
					max={STEP_COUNT}
				/>
				<div
					aria-hidden="true"
					className="h-1 w-full overflow-hidden rounded-full bg-muted"
				>
					<div
						className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-out"
						style={{ width: `${(completed / STEP_COUNT) * 100}%` }}
					/>
				</div>
				{onContinue && hub.state !== "ready" && (
					<button
						type="button"
						onClick={onContinue}
						className="text-sm text-primary underline underline-offset-4"
					>
						Continue to sign-in, settings, or remote environments
					</button>
				)}
			</div>

			{failed && (
				<div className="flex w-full max-w-md flex-col items-center gap-3 text-center text-sm">
					<p className="whitespace-pre-wrap text-muted-foreground">
						{readiness.retryError ?? (connected ? hub.message : startup?.error)}
					</p>
					{!connected && startup?.exitStatus && <p>{startup.exitStatus}</p>}
					{!connected && !!startup?.diagnostics.length && (
						<details className="w-full text-left">
							<summary className="cursor-pointer text-muted-foreground">
								Startup diagnostics
							</summary>
							<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
								{startup.diagnostics.join("\n")}
							</pre>
						</details>
					)}
					<button
						type="button"
						onClick={() => void readiness.retry()}
						className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
					>
						Retry
					</button>
				</div>
			)}
		</main>
	);
}
