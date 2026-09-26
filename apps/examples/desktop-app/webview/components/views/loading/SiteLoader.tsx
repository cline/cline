"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { useDesktopReadiness } from "@/hooks/use-desktop-readiness";
import { LoadingScreen } from "./LoadingScreen";

export function SiteLoader({
	children,
	readiness,
}: {
	children: ReactNode;
	readiness: ReturnType<typeof useDesktopReadiness>;
}) {
	const [continueWithoutHub, setContinueWithoutHub] = useState(false);
	const showApp =
		readiness.transport === "connected" &&
		(readiness.hub.state === "ready" || continueWithoutHub);
	// Once shown, keep the app mounted through a transport blip so unsent
	// drafts and attachments survive the reconnect.
	const [hasLoaded, setHasLoaded] = useState(false);
	useEffect(() => {
		if (showApp) setHasLoaded(true);
	}, [showApp]);
	return (
		<>
			{(showApp || hasLoaded) && (
				<div className="h-screen" hidden={!showApp} inert={!showApp}>
					{children}
				</div>
			)}
			{!showApp && (
				<LoadingScreen
					readiness={readiness}
					onContinue={
						readiness.transport === "connected"
							? () => setContinueWithoutHub(true)
							: undefined
					}
				/>
			)}
		</>
	);
}
