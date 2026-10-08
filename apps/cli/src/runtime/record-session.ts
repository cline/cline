/**
 * Sessions are recorded only by the hub. Returns why a `--record-session`
 * run cannot use the hub, or undefined when it can.
 */
export function recordSessionUnsupportedReason(input: {
	acp: boolean;
	sandbox: boolean;
	backendMode: string | undefined;
}): string | undefined {
	if (input.acp) {
		return "--record-session cannot be combined with --acp: recording needs the hub, and ACP sessions do not run there.";
	}
	if (input.sandbox) {
		return "--record-session cannot be combined with --data-dir or CLINE_SANDBOX=1: recording needs the hub, and sandboxed sessions always run locally.";
	}
	const backendMode = input.backendMode?.trim().toLowerCase();
	if (backendMode && backendMode !== "auto" && backendMode !== "hub") {
		return `--record-session needs the hub, but CLINE_SESSION_BACKEND_MODE=${backendMode} is set.`;
	}
	return undefined;
}
