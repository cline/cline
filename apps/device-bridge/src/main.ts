#!/usr/bin/env bun
import { join } from "node:path";
import { parseArgs } from "node:util";
import { resolveClineDataDir } from "@cline/shared/storage";
import { DeviceRegistry } from "./pairing";
import {
	DEFAULT_DEVICE_PORT,
	DEFAULT_WEB_PORT,
	startDeviceBridge,
} from "./runtime";
const { values } = parseArgs({
	options: {
		port: { type: "string", default: process.env.CLINE_DEVICE_PORT },
		host: {
			type: "string",
			default: process.env.CLINE_DEVICE_HOST ?? "0.0.0.0",
		},
		workspace: { type: "string", default: process.env.CLINE_DEVICE_WORKSPACE },
		pair: { type: "boolean", default: false },
		"list-devices": { type: "boolean", default: false },
		revoke: { type: "string" },
		"no-mdns": { type: "boolean", default: false },
		"web-port": { type: "string", default: process.env.CLINE_DEVICE_WEB_PORT },
		"no-web": { type: "boolean", default: false },
		help: { type: "boolean", short: "h", default: false },
	},
});

if (values.help) {
	console.log(`cline-device-bridge — LAN bridge for the Cline Device e-ink companion

  --pair              print a one-time pairing code (valid 5 min)
  --port <n>          device WebSocket port (default ${DEFAULT_DEVICE_PORT})
  --host <addr>       bind address (default 0.0.0.0)
  --workspace <dir>   pin the workspace for voice prompts that start a new task
                      (default: the workspace you last used Cline in)
  --list-devices      list paired devices
  --revoke <name>     unpair a device
  --no-mdns           don't advertise _clinedevice._tcp on the LAN
  --web-port <n>      HTTPS port for the browser device (default ${DEFAULT_WEB_PORT})
  --no-web            don't serve the browser device`);
	process.exit(0);
}

const registry = new DeviceRegistry(
	join(resolveClineDataDir(), "device-bridge", "devices.json"),
);

if (values["list-devices"]) {
	for (const d of registry.list()) {
		console.log(
			`${d.name}\tpaired ${d.pairedAt}\tlast seen ${d.lastSeenAt ?? "never"}`,
		);
	}
	process.exit(0);
}
if (values.revoke) {
	console.log(
		registry.revoke(values.revoke)
			? `revoked ${values.revoke}`
			: "no such device",
	);
	process.exit(0);
}

const runtime = await startDeviceBridge({
	port: values.port ? Number(values.port) : undefined,
	host: values.host,
	workspace: values.workspace,
	pair: values.pair,
	mdns: !values["no-mdns"],
	web: !values["no-web"],
	webPort: values["web-port"] ? Number(values["web-port"]) : undefined,
	registry,
});
const shutdown = async () => {
	await runtime.stop();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
