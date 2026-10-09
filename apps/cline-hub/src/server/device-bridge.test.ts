import { describe, expect, it, vi } from "vitest";
import type {
	StartDeviceBridgeOptions,
	DeviceBridgeRuntime,
} from "@cline/device-bridge";
import { DeviceBridgeController } from "./device-bridge";

const hub = { url: "ws://127.0.0.1:25466/hub", authToken: "test-secret" };
const status = {
	service: "cline-device-bridge" as const,
	hubUrl: hub.url,
	hubConnected: true,
	deviceEndpoint: "ws://192.168.1.2:25470/device",
	browserEndpoint: "https://192.168.1.2:25471/",
	devices: ["desk device"],
};
const missing = async () => new Response(null, { status: 404 });
function setup(
	start: NonNullable<
		ConstructorParameters<typeof DeviceBridgeController>[0]["start"]
	>,
	request = missing,
) {
	return new DeviceBridgeController({
		hub: () => hub,
		changed: vi.fn(),
		webviewDistDir: "/missing/webview",
		start,
		fetch: request,
	});
}

describe("dashboard device bridge", () => {
	it("issues pairing codes only for the owned runtime and reports their live lifecycle", async () => {
		let pairing: { code: string; expiresAt: number } | undefined;
		const pair = vi.fn(() => {
			pairing = { code: "012345", expiresAt: Date.now() + 300000 };
		});
		const controller = setup(async () => ({
			status: () => status,
			pair,
			pairingCode: () => pairing,
			stop: async () => {},
		}));
		controller.pair();
		expect(pair).not.toHaveBeenCalled();
		await controller.start();
		controller.pair();
		expect(controller.snapshot().pairing?.code).toBe("012345");
		pairing = undefined;
		expect(controller.snapshot().pairing).toBeUndefined();
		await controller.stop();
		expect(controller.snapshot().pairing).toBeUndefined();
	});
	it("starts on this dashboard's hub, reports live devices, and disposes it", async () => {
		const stop = vi.fn(async () => {});
		const start = vi.fn(async (_options?: StartDeviceBridgeOptions) => ({
			status: () => status,
			pair: vi.fn(),
			pairingCode: () => undefined,
			stop,
		}));
		const controller = setup(start);
		await controller.start();
		await controller.start();
		expect(start).toHaveBeenCalledTimes(1);
		expect(start.mock.calls[0]?.[0]).toMatchObject({ hub });
		expect(controller.snapshot()).toMatchObject({
			status: "running",
			devices: ["desk device"],
			deviceEndpoint: status.deviceEndpoint,
		});
		expect(JSON.stringify(controller.snapshot())).not.toContain("test-secret");
		await controller.stop();
		expect(stop).toHaveBeenCalledTimes(1);
		expect(controller.snapshot().status).toBe("stopped");
	});
	it("deduplicates starts and waits for startup before stopping", async () => {
		let finish!: (runtime: DeviceBridgeRuntime) => void;
		const stop = vi.fn(async () => {});
		const start = vi.fn(
			() =>
				new Promise<DeviceBridgeRuntime>((resolve) => {
					finish = resolve;
				}),
		);
		const controller = setup(start);
		const first = controller.start();
		const second = controller.start();
		expect(first).toBe(second);
		const stopped = controller.stop();
		await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
		finish({
			status: () => status,
			pair: vi.fn(),
			pairingCode: () => undefined,
			stop,
		});
		await stopped;
		expect(controller.snapshot().status).toBe("stopped");
		expect(stop).toHaveBeenCalledTimes(1);
	});
	it("reports an external bridge's actual hub without launching or stopping it", async () => {
		const start = vi.fn(async () => {
			throw new Error("should not start");
		});
		const request = vi.fn(async () =>
			Response.json({ ...status, hubUrl: "ws://127.0.0.1:25463/hub" }),
		);
		const controller = setup(start, request);
		await controller.refresh();
		await controller.start();
		await controller.stop();
		expect(start).not.toHaveBeenCalled();
		expect(controller.snapshot()).toMatchObject({
			status: "external",
			hubUrl: "ws://127.0.0.1:25463/hub",
			devices: ["desk device"],
		});
		request.mockImplementation(async () => new Response(null, { status: 404 }));
		await controller.refresh();
		expect(controller.snapshot().status).toBe("stopped");
	});
	it("keeps legacy external bridges read-only and makes startup failures reviewable", async () => {
		const controller = setup(async () => {
			throw new Error("port is busy");
		});
		await controller.start();
		expect(controller.snapshot()).toMatchObject({
			status: "error",
			error: "port is busy",
		});
		const legacy = setup(
			async () => {
				throw new Error("should not start");
			},
			async () => Response.json({ ok: true, v: 1 }),
		);
		await legacy.start();
		expect(legacy.snapshot()).toMatchObject({
			status: "external",
			error: expect.stringContaining("Stop it in its terminal"),
		});
	});
});
