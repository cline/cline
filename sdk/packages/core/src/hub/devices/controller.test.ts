import { expect, it, vi } from "vitest";
import type { NativeHubTransport } from "../server/native-transport";
import { HubDeviceService } from "./controller";
import type { DeviceServiceRuntime } from "./runtime";

const transport: NativeHubTransport = {
	subscribe: () => () => {},
	handleCommand: async () => ({ version: "v1", ok: true }),
};
const status = {
	service: "cline-device-service" as const,
	hubUrl: "ws://localhost/hub",
	hubConnected: true,
	deviceEndpoint: "ws://localhost/device",
	devices: [],
};
it("owns one service across simultaneous app requests and waits for shutdown before restarting", async () => {
	let resolve!: (runtime: DeviceServiceRuntime) => void;
	let stopped!: () => void;
	const pair = vi.fn();
	const stop = vi.fn(
		() =>
			new Promise<void>((r) => {
				stopped = r;
			}),
	);
	const start = vi.fn(
		() =>
			new Promise<DeviceServiceRuntime>((r) => {
				resolve = r;
			}),
	);
	const controller = new HubDeviceService(transport, {}, vi.fn(), start);
	const first = controller.start(status.hubUrl);
	const second = controller.start(status.hubUrl);
	expect(start).toHaveBeenCalledTimes(1);
	expect(controller.snapshot().status).toBe("starting");
	resolve({
		status: () => status,
		pair,
		pairingCode: () => ({ code: "123456", expiresAt: 1000 }),
		stop,
	});
	await Promise.all([first, second]);
	expect(controller.snapshot().status).toBe("running");
	controller.pair();
	expect(pair).toHaveBeenCalledTimes(1);
	const closing = controller.stop();
	const restarting = controller.start(status.hubUrl);
	await Promise.resolve();
	expect(start).toHaveBeenCalledTimes(1);
	stopped();
	await closing;
	await Promise.resolve();
	expect(start).toHaveBeenCalledTimes(2);
	resolve({
		status: () => status,
		pair,
		pairingCode: () => undefined,
		stop: async () => {},
	});
	await restarting;
	await controller.stop();
	expect(controller.snapshot().status).toBe("stopped");
});
it("keeps a device listener failure separate from hub health", async () => {
	const start = vi.fn(async () => {
		throw new Error("Port already in use");
	});
	const controller = new HubDeviceService(transport, {}, vi.fn(), start);
	await controller.start(status.hubUrl);
	expect(controller.snapshot()).toMatchObject({
		status: "error",
		error: "Port already in use",
	});
	await controller.stop();
	expect(controller.snapshot().status).toBe("stopped");
});
