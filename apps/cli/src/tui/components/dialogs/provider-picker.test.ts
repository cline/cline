import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderSettingsManager } from "@cline/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	getPersistedProviderApiKey,
	isProviderConfigured,
} from "../../../utils/provider-auth";
import {
	buildClinePassSubscriptionPageUrl,
	saveManualProviderApiKey,
} from "./provider-picker-helpers";

describe("buildClinePassSubscriptionPageUrl", () => {
	it("opens the personal subscription page on production by default", () => {
		expect(buildClinePassSubscriptionPageUrl(undefined)).toBe(
			"https://app.cline.bot/dashboard/subscription?personal=true&code=CLI-8OFF",
		);
	});

	it("keeps the configured app base URL", () => {
		expect(
			buildClinePassSubscriptionPageUrl("https://staging-app.cline.bot"),
		).toBe(
			"https://staging-app.cline.bot/dashboard/subscription?personal=true&code=CLI-8OFF",
		);
	});
});

describe("saveManualProviderApiKey", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	function createManager(): ProviderSettingsManager {
		const dir = mkdtempSync(join(tmpdir(), "cline-cli-provider-picker-"));
		tempDirs.push(dir);
		return new ProviderSettingsManager({
			filePath: join(dir, "providers.json"),
		});
	}

	it("clears stored OAuth tokens so the manual key takes effect", () => {
		const manager = createManager();
		manager.saveProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "stale-access-token",
				refreshToken: "stale-refresh-token",
				accountId: "acct_123",
			},
		});

		saveManualProviderApiKey(manager, "cline", "manual-api-key");

		const settings = manager.getProviderSettings("cline");
		expect(settings?.apiKey).toBe("manual-api-key");
		expect(settings?.auth?.accessToken).toBeUndefined();
		expect(settings?.auth?.refreshToken).toBeUndefined();
		expect(settings?.auth?.accountId).toBe("acct_123");
		expect(getPersistedProviderApiKey("cline", settings)).toBe(
			"manual-api-key",
		);
		expect(isProviderConfigured("cline", settings)).toBe(true);
	});

	it("saves cline-pass keys to the shared cline auth storage entry", () => {
		const manager = createManager();
		manager.saveProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "stale-access-token",
				refreshToken: "stale-refresh-token",
			},
		});

		saveManualProviderApiKey(manager, "cline-pass", "manual-api-key");

		// cline-pass inherits auth storage from the "cline" entry, so the key
		// must land there and the stale tokens must be gone for both providers.
		const clineSettings = manager.getProviderSettings("cline");
		expect(clineSettings?.apiKey).toBe("manual-api-key");
		expect(clineSettings?.auth?.accessToken).toBeUndefined();

		const clinePassSettings = manager.getProviderSettings("cline-pass");
		expect(getPersistedProviderApiKey("cline-pass", clinePassSettings)).toBe(
			"manual-api-key",
		);
		expect(isProviderConfigured("cline-pass", clinePassSettings)).toBe(true);
	});

	it("clears stale credentials copied into a direct cline-pass entry", () => {
		const manager = createManager();
		manager.saveProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "stale-access-token",
				refreshToken: "stale-refresh-token",
			},
		});
		// Provider switching copies the merged settings (including auth) into
		// a direct cline-pass entry, which shadows the shared "cline" entry.
		manager.saveProviderSettings({
			provider: "cline-pass",
			apiKey: "stale-copied-key",
			auth: {
				accessToken: "stale-access-token",
				refreshToken: "stale-refresh-token",
			},
		});

		saveManualProviderApiKey(manager, "cline-pass", "manual-api-key");

		const clinePassSettings = manager.getProviderSettings("cline-pass");
		expect(clinePassSettings?.auth?.accessToken).toBeUndefined();
		expect(getPersistedProviderApiKey("cline-pass", clinePassSettings)).toBe(
			"manual-api-key",
		);
	});
});
