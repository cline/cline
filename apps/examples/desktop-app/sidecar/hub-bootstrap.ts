import type { HubBrowserConnection } from "@cline/core/hub/browser";

const connections = new Map<string, HubBrowserConnection>();
/** Native control-plane data only. Never log credentials or broadcast them to sidecar clients. */
export function publishDesktopHubConnection(
	environmentId: string,
	workspaceRoot: string,
	connection: { url: string; authToken?: string },
) {
	if (!connection.authToken) {
		revokeDesktopHubConnection(environmentId);
		return;
	}
	const value = {
		url: connection.url,
		authToken: connection.authToken,
		workspaceRoot,
	};
	connections.set(environmentId, value);
	writeNativeRecord(
		`${JSON.stringify({ type: "hub-connection", environmentId, connection: value })}\n`,
	);
}
export function revokeDesktopHubConnection(environmentId: string) {
	connections.delete(environmentId);
	writeNativeRecord(
		`${JSON.stringify({ type: "hub-connection", environmentId, connection: null })}\n`,
	);
}
export function getDesktopHubConnection(environmentId: string) {
	return connections.get(environmentId);
}

function writeNativeRecord(record: string) {
	if (process.env.CLINE_DESKTOP_NATIVE_BOOTSTRAP === "1")
		process.stdout.write(record);
}
