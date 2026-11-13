import { beforeEach, describe, expect, it, vi } from "vitest";
import { HUB_UPGRADE_TIMEOUT_MS } from "@/components/hub-update-required-helpers";
import { desktopClient } from "@/lib/desktop-client";
import {
	FactorySettingsUnavailable,
	factorySettingsClient,
	isRefused,
	isUnavailable,
} from "./factory-settings-client";

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: vi.fn() },
}));
const invoke = vi.mocked(desktopClient.invoke);

beforeEach(() => {
	invoke.mockReset();
});

describe("factorySettingsClient", () => {
	it("sends each command with its payload and returns the reply", async () => {
		invoke.mockResolvedValue({ removed: 2, bytes: 10 });
		await expect(factorySettingsClient.cleanStorage()).resolves.toEqual({
			removed: 2,
			bytes: 10,
		});
		expect(invoke).toHaveBeenCalledWith("factory_clean_storage", {
			what: "finished_worktrees",
		});
	});

	it("gives the Hub upgrade the Hub update dialog's deadline", async () => {
		invoke.mockResolvedValue({ outcome: "upgraded" });
		await factorySettingsClient.upgradeHub();
		expect(invoke).toHaveBeenCalledWith("hub_upgrade", undefined, {
			timeoutMs: HUB_UPGRADE_TIMEOUT_MS,
		});
	});

	it("is unavailable when the sidecar does not know the command", async () => {
		invoke.mockRejectedValue(
			new Error("unsupported desktop command: factory_get_storage"),
		);
		const cause = await factorySettingsClient.getStorage().catch((e) => e);
		expect(isUnavailable(cause)).toBe(true);
		expect(cause).toMatchObject({
			command: "factory_get_storage",
			reason: "build",
		});
	});

	it("is unavailable, Hub too old, on { supported: false }", async () => {
		invoke.mockResolvedValue({ supported: false });
		const cause = await factorySettingsClient
			.getVerification("/work/app")
			.catch((e) => e);
		expect(cause).toBeInstanceOf(FactorySettingsUnavailable);
		expect(cause.reason).toBe("hub");
	});

	it("passes other failures through", async () => {
		invoke.mockRejectedValue(new Error("expected hash does not match"));
		const cause = await factorySettingsClient
			.setGuidance({
				role: "builder",
				scope: "user",
				expectedHash: "x",
				content: "",
			})
			.catch((e) => e);
		expect(isUnavailable(cause)).toBe(false);
		expect(cause.message).toBe("expected hash does not match");
	});

	it("turns a refusal the person can act on into an error with its code and hash", async () => {
		invoke.mockResolvedValue({
			supported: true,
			ok: false,
			error: {
				code: "factory_guidance_stale",
				message: "This guidance changed.",
				currentHash: "abc",
			},
		});
		const cause = await factorySettingsClient
			.resolveGuidance({
				role: "builder",
				scope: "user",
				expectedHash: "x",
				decision: "accept",
			})
			.catch((e) => e);
		expect(isRefused(cause)).toBe(true);
		expect(cause).toMatchObject({
			code: "factory_guidance_stale",
			message: "This guidance changed.",
			currentHash: "abc",
		});
	});
});
