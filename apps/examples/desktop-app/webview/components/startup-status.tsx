"use client";

import type { useDesktopReadiness } from "@/hooks/use-desktop-readiness";

export function StartupStatus({
	readiness,
	service,
}: {
	readiness: ReturnType<typeof useDesktopReadiness>;
	service: "desktop" | "hub";
}) {
	const failed =
		service === "hub"
			? readiness.hub.state === "failed"
			: readiness.startup?.state === "failed" ||
				(readiness.startup?.state !== "starting" &&
					readiness.transport === "unavailable");
	const message =
		readiness.retryError ??
		(service === "hub" ? readiness.hub.message : readiness.startup?.error);
	return (
		<div
			role={failed ? "alert" : "status"}
			aria-live="polite"
			className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background p-6 text-foreground"
		>
			{!failed && (
				<div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
			)}
			<p className="text-sm">
				{service === "hub"
					? failed
						? "Session service failed to start"
						: "Starting session service…"
					: failed
						? "Cline failed to start"
						: "Starting Cline…"}
			</p>
			{message && (
				<p className="max-w-xl whitespace-pre-wrap text-center text-sm text-muted-foreground">
					{message}
				</p>
			)}
			{service === "desktop" && readiness.startup?.exitStatus && (
				<p className="text-xs">{readiness.startup.exitStatus}</p>
			)}
			{service === "desktop" && !!readiness.startup?.diagnostics.length && (
				<details className="max-w-xl">
					<summary>Startup diagnostics</summary>
					<pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs">
						{readiness.startup.diagnostics.join("\n")}
					</pre>
				</details>
			)}
			{(failed || readiness.retryError) && (
				<button
					type="button"
					disabled={readiness.retrying}
					onClick={() => void readiness.retry()}
					className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
				>
					{readiness.retrying ? "Retrying…" : "Retry"}
				</button>
			)}
		</div>
	);
}
