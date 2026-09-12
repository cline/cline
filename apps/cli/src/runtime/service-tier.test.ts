import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderSettingsManager } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import type { ChatCommandState } from "../utils/chat-commands";
import type { Config } from "../utils/types";
import { buildInteractiveSessionConfig } from "./interactive/session-config";
import { applyInteractiveModelChange } from "./run-interactive";

describe("CLI Fast persistence and startup", () => {
	it.each([
		false,
		true,
	] as const)("round-trips priority and removes it without changing thinking=%s", async (thinking) => {
		const directory = mkdtempSync(join(tmpdir(), "cline-cli-tier-"));
		const filePath = join(directory, "providers.json");
		try {
			const manager = new ProviderSettingsManager({ filePath });
			const config = {
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				thinking,
				serviceTier: "priority",
			} as Config;
			const sessionRuntime = {
				ensureReady: vi.fn(async () => {}),
				restartWithCurrentMessages: vi.fn(async () => {}),
				updateCurrentSessionConnection: vi.fn(async () => {}),
			};
			for (const serviceTier of ["priority", undefined] as const) {
				config.serviceTier = serviceTier;
				await applyInteractiveModelChange({
					config,
					providerSettingsManager: manager,
					sessionRuntime,
				});
				const saved = new ProviderSettingsManager({
					filePath,
				}).getProviderSettings(config.providerId);
				expect(saved?.serviceTier).toBe(serviceTier);
				expect(saved?.reasoning).toEqual({ enabled: thinking });
				expect(config.thinking).toBe(thinking);
				expect(
					sessionRuntime.updateCurrentSessionConnection,
				).toHaveBeenLastCalledWith({
					providerId: config.providerId,
					modelId: config.modelId,
					serviceTier: serviceTier ?? null,
				});
				const startup = buildInteractiveSessionConfig({
					config: { ...config, serviceTier: saved?.serviceTier },
					chatCommandState: { enableTools: true } as ChatCommandState,
					runtimeHooks: {},
					onTeamEvent: () => {},
					resolveMistakeLimitDecision: undefined,
				});
				expect(startup.serviceTier).toBe(serviceTier);
				expect(startup.thinking).toBe(thinking);
			}
			expect(readFileSync(filePath, "utf8")).not.toContain("serviceTier");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
