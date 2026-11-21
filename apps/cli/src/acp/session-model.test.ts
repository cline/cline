import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { Llms, ProviderSettingsManager } from "@cline/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcpAgent } from "./acpAgent";

describe("ACP session model", () => {
	let dir: string | undefined;

	afterEach(() => {
		vi.unstubAllEnvs();
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("starts new sessions on the model saved for the provider", async () => {
		dir = mkdtempSync(join(tmpdir(), "cline-acp-model-"));
		vi.stubEnv("CLINE_PROVIDER_SETTINGS_PATH", join(dir, "providers.json"));
		vi.stubEnv("CLINE_PROVIDER", "anthropic");
		vi.stubEnv("CLINE_API_KEY", "test-key");
		vi.stubEnv("CLINE_MODEL", undefined);

		const providerDefault = (await Llms.getProvider("anthropic"))
			?.defaultModelId;
		const saved = Object.keys(
			await Llms.getModelsForProvider("anthropic", { filter: "chat" }),
		).find((id) => id !== providerDefault);
		expect(saved).toBeDefined();
		new ProviderSettingsManager().saveProviderSettings({
			provider: "anthropic",
			model: saved,
		});

		const session = await new AcpAgent({} as AgentSideConnection).newSession({
			cwd: dir,
			mcpServers: [],
		});

		expect(session.models?.currentModelId).toBe(saved);
	});
});
