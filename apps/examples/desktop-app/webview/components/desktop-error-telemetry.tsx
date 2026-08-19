"use client";

import { useEffect } from "react";
import { desktopClient } from "@/lib/desktop-client";

export function DesktopErrorTelemetry() {
	useEffect(() => {
		const onError = (event: ErrorEvent) => {
			desktopClient.reportError({
				operation: "webview.uncaught_error",
				error:
					event.error ?? new Error(event.message || "Unknown webview error"),
				handled: false,
				// For script-load failures (e.g. a chunk URL answered with HTML)
				// the ErrorEvent's filename is the only pointer to the failing
				// resource — the error object has no stack in that case.
				sourceUrl: event.filename || undefined,
				lineno: event.lineno || undefined,
				colno: event.colno || undefined,
			});
		};
		const onUnhandledRejection = (event: PromiseRejectionEvent) => {
			desktopClient.reportError({
				operation: "webview.unhandled_rejection",
				error: event.reason,
				handled: false,
			});
		};

		window.addEventListener("error", onError);
		window.addEventListener("unhandledrejection", onUnhandledRejection);
		return () => {
			window.removeEventListener("error", onError);
			window.removeEventListener("unhandledrejection", onUnhandledRejection);
		};
	}, []);

	return null;
}
