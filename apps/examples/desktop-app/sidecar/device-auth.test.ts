import type { ProviderSettingsManager } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import {
	cancelClineDeviceAuthFlow,
	cancelClineDeviceAuthFlowsForOwner,
	completeClineDeviceAuthFlow,
	DeviceAuthCancelledError,
	type DeviceAuthDependencies,
	startClineDeviceAuthFlow,
} from "./device-auth";

type Credentials = { accessToken: string };

const AUTHORIZATION = {
	deviceCode: "device-code-secret",
	userCode: "ABCD-1234",
	verificationUri: "https://auth.example.com/device",
	verificationUriComplete: "https://auth.example.com/device?code=ABCD-1234",
	expiresInSeconds: 300,
	pollIntervalSeconds: 1,
};

function makeManager(): ProviderSettingsManager {
	return {
		getProviderSettings: () => undefined,
	} as unknown as ProviderSettingsManager;
}

function makeDependencies(overrides: {
	complete?: () => Promise<Credentials>;
	save?: ReturnType<typeof vi.fn>;
}) {
	const save =
		overrides.save ??
		vi.fn(() => ({
			provider: "cline",
			auth: { accessToken: "saved-token" },
		}));
	const complete =
		overrides.complete ?? (async () => ({ accessToken: "fresh-token" }));
	return {
		dependencies: {
			start: vi.fn(async () => AUTHORIZATION) as never,
			complete: complete as never,
			save: save as never,
			markEnabled: vi.fn() as never,
		} satisfies DeviceAuthDependencies,
		save,
	};
}

describe("cline device auth flow", () => {
	it("returns the user-facing code but keeps the device code sidecar-side", async () => {
		const { dependencies } = makeDependencies({});

		const started = await startClineDeviceAuthFlow({}, dependencies);

		expect(started.userCode).toBe("ABCD-1234");
		expect(started.verificationUri).toBe(AUTHORIZATION.verificationUri);
		expect(started.verificationUriComplete).toBe(
			AUTHORIZATION.verificationUriComplete,
		);
		expect(started.authId).toBeTruthy();
		// The polling secret never crosses the transport.
		expect(JSON.stringify(started)).not.toContain("device-code-secret");

		expect(cancelClineDeviceAuthFlow(started.authId)).toBe(true);
	});

	it("polls to completion and persists credentials", async () => {
		const complete = vi.fn(async () => ({ accessToken: "fresh-token" }));
		const { dependencies, save } = makeDependencies({ complete });

		const started = await startClineDeviceAuthFlow({}, dependencies);
		const result = await completeClineDeviceAuthFlow(
			makeManager(),
			started.authId,
			dependencies,
		);

		expect(complete).toHaveBeenCalledWith(
			expect.objectContaining({
				deviceCode: "device-code-secret",
				expiresInSeconds: 300,
				pollIntervalSeconds: 1,
			}),
		);
		expect(save).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ provider: "cline", accessToken: "saved-token" });

		// The attempt is single-use.
		await expect(
			completeClineDeviceAuthFlow(makeManager(), started.authId, dependencies),
		).rejects.toThrow("Unknown or expired device sign-in attempt");
	});

	it("rejects promptly on cancel and never persists a late approval", async () => {
		let resolvePoll: (credentials: Credentials) => void = () => undefined;
		const { dependencies, save } = makeDependencies({
			complete: () =>
				new Promise<Credentials>((resolve) => {
					resolvePoll = resolve;
				}),
		});

		const started = await startClineDeviceAuthFlow({}, dependencies);
		const pending = completeClineDeviceAuthFlow(
			makeManager(),
			started.authId,
			dependencies,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(cancelClineDeviceAuthFlow(started.authId)).toBe(true);
		await expect(pending).rejects.toBeInstanceOf(DeviceAuthCancelledError);

		// The user approves the abandoned code afterwards: credentials must be
		// discarded, not saved.
		resolvePoll({ accessToken: "late-token" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(save).not.toHaveBeenCalled();
	});

	it("rejects completion of an attempt cancelled before polling started", async () => {
		const { dependencies, save } = makeDependencies({});

		const started = await startClineDeviceAuthFlow({}, dependencies);
		expect(cancelClineDeviceAuthFlow(started.authId)).toBe(true);

		await expect(
			completeClineDeviceAuthFlow(makeManager(), started.authId, dependencies),
		).rejects.toThrow();
		expect(save).not.toHaveBeenCalled();
	});

	it("reports when there is no pending attempt to cancel", () => {
		expect(cancelClineDeviceAuthFlow("missing")).toBe(false);
	});

	it("cancels pending attempts when their transport connection closes", async () => {
		let resolvePoll: (credentials: Credentials) => void = () => undefined;
		const { dependencies, save } = makeDependencies({
			complete: () =>
				new Promise<Credentials>((resolve) => {
					resolvePoll = resolve;
				}),
		});
		const connection = {};

		const started = await startClineDeviceAuthFlow(
			{ owner: connection },
			dependencies,
		);
		const pending = completeClineDeviceAuthFlow(
			makeManager(),
			started.authId,
			dependencies,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		// A different connection closing must not cancel this attempt.
		expect(cancelClineDeviceAuthFlowsForOwner({})).toBe(0);

		// The initiating connection closing cancels it, so a webview reload
		// can never leave a dangling poll that persists credentials later.
		expect(cancelClineDeviceAuthFlowsForOwner(connection)).toBe(1);
		await expect(pending).rejects.toBeInstanceOf(DeviceAuthCancelledError);

		resolvePoll({ accessToken: "late-token" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(save).not.toHaveBeenCalled();
	});
});
