import type { Settings } from "../settings/settings";
import type { SourceEnv } from "./source";

/**
 * Which sources are off for this run, from the person's settings and the
 * planner-provider rule: a context
 * toggle turned off, a connector set to Off, or history while the planner
 * would send it to another provider. An off source is never probed and
 * never named.
 */

/** Source ids the settings page toggles, and the setting each one reads. */
export const CONTEXT_TOGGLES: Readonly<
	Record<string, keyof Settings["context"]>
> = {
	tasks: "tasks",
	status: "status",
	history: "history",
	"cline-setup": "clineSetup",
	repo: "repo",
};

/** Sources that read the person's other chats or accounts: they may reach only the provider the chat already uses. */
export const CROSS_CHAT_SOURCES: ReadonlySet<string> = new Set(["history"]);

/** True when the planner sends to the same provider as this chat, so reading other chats sends nowhere new. */
export function plannerSharesChatProvider(
	settings: Settings,
	chatProviderId: string | undefined,
): boolean {
	const model = settings.planner.model;
	return (
		model.kind === "chat" ||
		(chatProviderId !== undefined && model.providerId === chatProviderId)
	);
}

export function sourceOff(
	settings: Settings,
	env: Pick<SourceEnv, "providerId">,
): (sourceId: string) => boolean {
	const sharesProvider = plannerSharesChatProvider(settings, env.providerId);
	return (sourceId) => {
		const toggle = CONTEXT_TOGGLES[sourceId];
		if (toggle && !settings.context[toggle]) return true;
		if (settings.connectors[sourceId]?.role === "off") return true;
		return CROSS_CHAT_SOURCES.has(sourceId) && !sharesProvider;
	};
}
