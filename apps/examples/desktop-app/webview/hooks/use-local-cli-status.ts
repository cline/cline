import { useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

export type LocalCliStatus = {
	cli: { command: string; docsUrl?: string };
	status:
		| { installed: true; version: string }
		| { installed: false; reason: string };
};

type CheckLocalCliResponse = {
	provider: string;
	cli: LocalCliStatus["cli"] | null;
	status?: LocalCliStatus["status"];
};

/**
 * Whether the CLI a local-auth provider (Claude Code, Codex CLI, OpenCode)
 * borrows its sign-in from is installed on this machine. Mirrors the probe the
 * CLI's setup screen runs, so "Connect" doesn't claim a provider is ready when
 * the executable isn't there. `null` until the probe answers, and when the
 * provider names no CLI or the probe itself fails.
 */
export function useLocalCliStatus(
	providerId: string,
	enabled: boolean,
): LocalCliStatus | null {
	const [result, setResult] = useState<LocalCliStatus | null>(null);

	useEffect(() => {
		setResult(null);
		if (!enabled) {
			return;
		}
		let cancelled = false;
		desktopClient
			.invoke<CheckLocalCliResponse>("check_local_cli", {
				provider: providerId,
			})
			.then((response) => {
				if (cancelled || !response.cli || !response.status) return;
				setResult({ cli: response.cli, status: response.status });
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [providerId, enabled]);

	return result;
}
