import type { Settings } from "../settings/settings";
import type { ContextSource, SourceEnv } from "./source";

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

/**
 * Which sources are off for this run: a context toggle turned off, a
 * connector set to Off, or a source that reads other chats while the planner
 * would send it to another provider. An off source is never probed and never
 * named.
 */
export function sourceOff(
	settings: Settings,
	env: Pick<SourceEnv, "providerId">,
): (source: ContextSource) => boolean {
	const sharesProvider = plannerSharesChatProvider(settings, env.providerId);
	return (source) =>
		(source.settingsToggle !== undefined &&
			!settings.context[source.settingsToggle]) ||
		settings.connectors[source.id]?.role === "off" ||
		(source.readsOtherChats === true && !sharesProvider);
}
