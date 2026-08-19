/**
 * Credential injection at the engine boundary: mode-0600 secret files
 * are the durable source, environment variables are a local/dev
 * override, and a missing credential fails the attempt with a stable
 * error — an unauthenticated binding never reaches the engine.
 */

import type { EngineInvocation } from "@cline/bot";
import {
	createBotId,
	createRunId,
	createSessionId,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import {
	createConfiguredEnginePort,
	MissingProviderCredentialError,
	ModelNotConfiguredError,
	resolveProviderModel,
} from "./engine-binding";
import { resolveGatewayPaths } from "./paths";
import { writeSecretFile } from "./secrets";
import { tempDataRoot } from "./test-support";

function invocation(
	config: EngineInvocation["effectiveConfig"] = {},
): EngineInvocation {
	return {
		runId: createRunId(),
		sessionId: createSessionId(),
		botId: createBotId(),
		input: "prompt",
		workspaceRoot: "/tmp/w",
		effectiveConfig: config,
	};
}

function makePaths() {
	return resolveGatewayPaths({
		dataRoot: tempDataRoot(),
		namespace: "default",
	});
}

describe("resolveProviderModel", () => {
	it("reads the provider credential from the mode-0600 secret file (no env needed)", () => {
		const paths = makePaths();
		writeSecretFile(paths, "anthropic", "sk-from-file");
		const binding = resolveProviderModel(
			invocation({ providerId: "anthropic", modelId: "claude-x" }),
			{ env: {}, paths },
		);
		expect(binding).toEqual({
			kind: "provider",
			providerId: "anthropic",
			modelId: "claude-x",
			apiKey: "sk-from-file",
		});
	});

	it("environment variables override the secret file (local/dev convenience)", () => {
		const paths = makePaths();
		writeSecretFile(paths, "anthropic", "sk-from-file");
		const generic = resolveProviderModel(
			invocation({ providerId: "anthropic", modelId: "claude-x" }),
			{ env: { CLINE_GATEWAY_API_KEY: "sk-generic-env" }, paths },
		);
		expect(generic.kind === "provider" && generic.apiKey).toBe(
			"sk-generic-env",
		);
		const providerSpecific = resolveProviderModel(
			invocation({ providerId: "anthropic", modelId: "claude-x" }),
			{ env: { ANTHROPIC_API_KEY: "sk-anthropic-env" }, paths },
		);
		expect(
			providerSpecific.kind === "provider" && providerSpecific.apiKey,
		).toBe("sk-anthropic-env");
	});

	it("fails with a stable error when no credential exists anywhere", () => {
		const paths = makePaths();
		expect(() =>
			resolveProviderModel(
				invocation({ providerId: "anthropic", modelId: "claude-x" }),
				{ env: {}, paths },
			),
		).toThrow(MissingProviderCredentialError);
		// Without a secrets directory configured, env-less resolution also
		// fails closed rather than passing apiKey: undefined through.
		expect(() =>
			resolveProviderModel(
				invocation({ providerId: "anthropic", modelId: "claude-x" }),
				{ env: {} },
			),
		).toThrow(MissingProviderCredentialError);
	});

	it("fails with a stable error when no provider/model is configured", () => {
		expect(() => resolveProviderModel(invocation(), { env: {} })).toThrow(
			ModelNotConfiguredError,
		);
	});
});

describe("createConfiguredEnginePort", () => {
	it("settles a missing-credential run as a failed attempt with the stable error", async () => {
		const paths = makePaths();
		const port = createConfiguredEnginePort({ env: {}, paths });
		const handle = port.start(
			invocation({ providerId: "anthropic", modelId: "claude-x" }),
		);
		const outcome = await handle.result;
		expect(outcome.status).toBe("failed");
		expect(outcome.error?.name).toBe("MissingProviderCredentialError");
		expect(outcome.error?.message).toContain("secret-put anthropic");
		// The stable error never contains a key (there is none to leak).
		expect(outcome.error?.message).not.toContain("sk-");
	});
});
