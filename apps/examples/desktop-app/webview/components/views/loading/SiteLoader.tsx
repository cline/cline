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
	const ready =
		readiness.transport === "connected" && readiness.hub.state === "ready";
	const [minimumElapsed, setMinimumElapsed] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setMinimumElapsed(true), 10_000);
		return () => clearTimeout(timer);
	}, []);
	const showApp = ready && minimumElapsed;
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
			{!showApp && <LoadingScreen readiness={readiness} />}
		</>
	);
}
