import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	status: vi.fn(),
	catalog: vi.fn(),
	connect: vi.fn(),
	cancel: vi.fn(),
	open: vi.fn(),
	select: vi.fn(),
}));
vi.mock("@cline/core", () => ({
	getComposioStatus: mocks.status,
	listComposioToolkits: mocks.catalog,
	connectComposioToolkit: mocks.connect,
	cancelComposioConnect: mocks.cancel,
	parseComposioToolkitSlug: (s: string) => s,
}));
vi.mock("open", () => ({ default: mocks.open }));
vi.mock("@clack/prompts", () => ({
	select: mocks.select,
	isCancel: (v: unknown) => typeof v === "symbol",
}));

import {
	createConnectorCommand,
	installConnector,
	runInstalledConnectorsCommand,
} from "./connector";

const installed = {
	toolkit: "github",
	name: "GitHub",
	status: "connected",
	toolNames: ["issues"],
};
let io: {
	writeln: ReturnType<typeof vi.fn<(text: string) => void>>;
	writeErr: ReturnType<typeof vi.fn<(text: string) => void>>;
};
beforeEach(() => {
	vi.resetAllMocks();
	io = { writeln: vi.fn(), writeErr: vi.fn() };
});
describe("connector commands", () => {
	it("lists only installed connectors in JSON", async () => {
		mocks.status.mockResolvedValue({
			configured: true,
			integrations: [installed, { toolkit: "gmail", status: "not_connected" }],
		});
		expect(await runInstalledConnectorsCommand(true, io)).toBe(0);
		expect(JSON.parse(io.writeln.mock.calls[0][0])).toEqual([installed]);
	});
	it("reports unavailable accounts as a failure", async () => {
		mocks.status.mockResolvedValue({ configured: false, integrations: [] });
		expect(await runInstalledConnectorsCommand(false, io)).toBe(1);
		expect(io.writeErr).toHaveBeenCalledWith(
			expect.stringContaining("cline auth"),
		);
	});
	it("outputs the marketplace without prompting in JSON mode", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [{ slug: "github", name: "GitHub" }],
		});
		const exit = vi.fn();
		await createConnectorCommand(io, exit, () => false).parseAsync(
			["list", "--json"],
			{ from: "user" },
		);
		expect(JSON.parse(io.writeln.mock.calls[0][0])).toEqual([
			{ slug: "github", name: "GitHub" },
		]);
		expect(mocks.select).not.toHaveBeenCalled();
		expect(exit).toHaveBeenCalledWith(0);
	});
	it("waits for OAuth completion before reporting installation", async () => {
		mocks.connect.mockResolvedValue({
			redirectUrl: "https://example.com/auth",
			status: {
				configured: true,
				integrations: [{ toolkit: "github", status: "pending" }],
			},
		});
		mocks.status.mockResolvedValue({
			configured: true,
			integrations: [installed],
		});
		await installConnector("github", io, true);
		expect(mocks.open).toHaveBeenCalledWith("https://example.com/auth");
		expect(io.writeln).toHaveBeenCalledExactlyOnceWith(
			JSON.stringify(installed),
		);
	});
	it("cancels a failed authorization and reports failure", async () => {
		mocks.connect.mockResolvedValue({
			status: {
				configured: true,
				integrations: [
					{
						toolkit: "github",
						status: "not_connected",
						error: "Authorization failed",
					},
				],
			},
		});
		const exit = vi.fn();
		await createConnectorCommand(io, exit, () => false).parseAsync(
			["install", "github"],
			{ from: "user" },
		);
		expect(mocks.cancel).toHaveBeenCalledWith("github");
		expect(exit).toHaveBeenCalledWith(1);
		expect(io.writeErr).toHaveBeenCalledWith("Authorization failed");
	});
	it("cancels OAuth on Ctrl+C and removes its signal handler", async () => {
		const before = process.listenerCount("SIGINT");
		mocks.connect.mockImplementation(async () => {
			process.emit("SIGINT");
			return {
				status: {
					configured: true,
					integrations: [{ toolkit: "github", status: "pending" }],
				},
			};
		});
		await expect(installConnector("github", io)).rejects.toThrow("cancelled");
		expect(mocks.cancel).toHaveBeenCalledWith("github");
		expect(process.listenerCount("SIGINT")).toBe(before);
	});
});
