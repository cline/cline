import type { SessionConfigOption } from "@agentclientprotocol/sdk";

export const AUTO_APPROVE_CONFIG_ID = "auto_approve";

export function buildAutoApproveConfigOption(
	currentValue: boolean,
): SessionConfigOption {
	return {
		type: "boolean",
		id: AUTO_APPROVE_CONFIG_ID,
		name: "Auto-approve tools",
		description:
			"Automatically approve all tool calls without asking for permission",
		currentValue,
	};
}

/**
 * Interpret the value of a `session/set_config_option` request for the
 * auto-approve option.
 *
 * The ACP schema sends booleans for boolean options, but clients that predate
 * boolean options may send the string form, so both are accepted. Returns
 * `undefined` for anything else so the caller can reject the request.
 */
export function parseAutoApproveValue(value: unknown): boolean | undefined {
	if (typeof value === "boolean" || value === undefined) {
		return value;
	}

	return value === "true" ? true : value === "false" ? false : undefined;
}
