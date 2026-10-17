import { PLUGIN_NAME } from "./config";
import type { SetupContext } from "./runtime";

export type Log = (message: string, error?: unknown) => void;

/** The session's debug log; the host stamps each record with the session and the plugin. */
export function pluginLog(context: Pick<SetupContext, "logger">): Log {
	return (message, error) =>
		context.logger?.debug(`[${PLUGIN_NAME}] ${message}`, { error });
}
