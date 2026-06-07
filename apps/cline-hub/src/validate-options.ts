import { buildInviteUrl, resolveClineHubServerOptions } from "./options";

function expectEqual<T>(actual: T, expected: T, label: string): void {
	if (actual !== expected) {
		throw new Error(
			`${label}: expected ${String(expected)}, got ${String(actual)}`,
		);
	}
}

function expectThrows(fn: () => unknown, label: string): void {
	try {
		fn();
	} catch {
		return;
	}
	throw new Error(`${label}: expected an error`);
}

const defaults = resolveClineHubServerOptions({});
expectEqual(defaults.host, "127.0.0.1", "default host");
expectEqual(defaults.port, 8787, "default port");
expectEqual(defaults.publicUrl, "http://127.0.0.1:8787", "default public URL");
expectEqual(defaults.roomSecret, undefined, "default room secret");

const lan = resolveClineHubServerOptions({
	HOST: "0.0.0.0",
	CLINE_HUB_DASHBOARD_PORT: "9000",
	PUBLIC_URL: "https://example.ngrok-free.app/",
	ROOM_SECRET: "invite-123",
	WORKSPACE_ROOT: "/tmp/workspace",
});
expectEqual(lan.host, "0.0.0.0", "LAN host");
expectEqual(lan.port, 9000, "LAN port");
expectEqual(lan.publicUrl, "https://example.ngrok-free.app", "LAN public URL");
expectEqual(lan.roomSecret, "invite-123", "LAN room secret");
expectEqual(lan.workspaceRoot, "/tmp/workspace", "workspace root");
expectEqual(
	buildInviteUrl(lan.publicUrl, lan.roomSecret),
	"https://example.ngrok-free.app/?roomSecret=invite-123",
	"invite URL",
);

expectThrows(
	() => resolveClineHubServerOptions({ HOST: "0.0.0.0" }),
	"non-local bind without ROOM_SECRET",
);
expectThrows(
	() => resolveClineHubServerOptions({ CLINE_HUB_DASHBOARD_PORT: "70000" }),
	"invalid dashboard port",
);
expectThrows(
	() => resolveClineHubServerOptions({ PUBLIC_URL: "ftp://example.test" }),
	"invalid PUBLIC_URL protocol",
);

console.log("cline-hub option validation passed");
