"use client";

import { AgentPullRequestBar } from "@cline/ui";
import { useEffect, useRef, useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import type { PullRequestStatus } from "@/lib/pull-request";
import { trackPullRequestEvent } from "@/lib/pull-request-telemetry";

export function PullRequestBar({
	cwd,
	branch,
}: {
	cwd: string;
	branch: string | null;
}) {
	// Remount on workspace/branch changes so another repository's PR never flashes.
	if (!cwd || !branch || branch === "no-git") return null;
	return <WorkspacePullRequestBar key={`${cwd}:${branch}`} cwd={cwd} />;
}

function WorkspacePullRequestBar({ cwd }: { cwd: string }) {
	const [data, setData] = useState<PullRequestStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const refresh = useRef<() => void>(() => {});
	const [loading, setLoading] = useState(false);
	const hasReportedShown = useRef(false);
	const hasLoadedStatus = useRef(false);
	const errorDismissed = useRef(false);

	useEffect(() => {
		if (hasReportedShown.current || document.visibilityState === "hidden")
			return;
		if (data?.pullRequest || data?.createUrl) {
			hasReportedShown.current = true;
			trackPullRequestEvent("shown", data);
		}
	}, [data]);

	useEffect(() => {
		let disposed = false;
		let inFlight = false;
		async function update() {
			if (inFlight || document.visibilityState === "hidden") return;
			inFlight = true;
			setLoading(true);
			try {
				const result = await desktopClient.invoke<PullRequestStatus | null>(
					"get_pull_request_status",
					{ cwd },
				);
				if (!disposed) {
					hasLoadedStatus.current = result !== null;
					errorDismissed.current = false;
					setData(result);
					setError(null);
				}
			} catch (cause) {
				if (!disposed) {
					setData(null);
					if (hasLoadedStatus.current && !errorDismissed.current) {
						setError(
							cause instanceof Error
								? cause.message
								: "Could not load pull request status.",
						);
					}
				}
			} finally {
				inFlight = false;
				if (!disposed) setLoading(false);
			}
		}
		refresh.current = () => void update();
		void update();
		const timer = window.setInterval(() => void update(), 30_000);
		const onFocus = () => void update();
		window.addEventListener("focus", onFocus);
		document.addEventListener("visibilitychange", onFocus);
		return () => {
			disposed = true;
			window.clearInterval(timer);
			window.removeEventListener("focus", onFocus);
			document.removeEventListener("visibilitychange", onFocus);
		};
	}, [cwd]);

	async function open(url: string) {
		try {
			await openExternalUrl(url);
		} catch {
			setError("Could not open GitHub in your browser. Try again.");
		}
	}

	if (!error && !data?.pullRequest && !data?.createUrl) return null;
	return (
		<AgentPullRequestBar
			data={data}
			error={error}
			loading={loading}
			onDismissError={() => {
				errorDismissed.current = true;
				setError(null);
			}}
			onRefresh={() => {
				trackPullRequestEvent("refresh_clicked", data);
				refresh.current();
			}}
			onNavigate={(url, action) => {
				if (action === "open") trackPullRequestEvent("open_clicked", data);
				if (action === "create") trackPullRequestEvent("create_clicked", data);
				if (action === "check") trackPullRequestEvent("check_clicked", data);
				void open(url);
			}}
			renderChecks={(trigger, content) => (
				<Popover
					onOpenChange={(isOpen) => {
						if (isOpen) trackPullRequestEvent("checks_expanded", data);
					}}
				>
					<PopoverTrigger asChild>{trigger}</PopoverTrigger>
					<PopoverContent align="end" className="w-80 p-0">
						{content}
					</PopoverContent>
				</Popover>
			)}
		/>
	);
}
