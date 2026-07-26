import type { ExtensionContext } from "@bedrock-coder/shared";
import type { RuntimeCapabilities } from "../runtime/capabilities";
import { normalizeRuntimeCapabilities } from "../runtime/capabilities";
import type {
	LocalRuntimeStartOptions,
	StartSessionInput,
} from "../runtime/host/runtime-host";
import { splitCoreSessionConfig } from "../runtime/host/runtime-host";
import type { BedrockCoderCoreStartConfig } from "../types/config";
import type { BedrockCoderCoreStartInput } from "./types";

export function toBedrockCoderCoreStartInput(
	input: StartSessionInput | BedrockCoderCoreStartInput,
): BedrockCoderCoreStartInput {
	const config = input.config as BedrockCoderCoreStartConfig;
	return "providerId" in config
		? {
				...input,
				config: {
					...config,
					...coreConfigFromLocalRuntime(input.localRuntime),
				},
				localRuntime: input.localRuntime,
			}
		: (input as BedrockCoderCoreStartInput);
}

export interface NormalizeBedrockCoderCoreStartInputOptions {
	defaultCapabilities?: RuntimeCapabilities;
	withExtensionContext?: (
		context?: ExtensionContext,
	) => ExtensionContext | undefined;
}

export function normalizeBedrockCoderCoreStartInput(
	input: BedrockCoderCoreStartInput,
	options: NormalizeBedrockCoderCoreStartInputOptions = {},
): StartSessionInput {
	const split = splitCoreSessionConfig(input.config);
	const capabilities = normalizeRuntimeCapabilities(
		options.defaultCapabilities,
		input.capabilities,
	);
	let localRuntime = mergeLocalRuntimeStartOptions(
		split.localRuntime,
		input.localRuntime,
	);
	const extensionContext = options.withExtensionContext?.(
		localRuntime?.extensionContext,
	);
	if (extensionContext) {
		localRuntime = {
			...(localRuntime ?? {}),
			extensionContext,
		};
	}
	return {
		...input,
		...split,
		...(localRuntime ? { localRuntime } : {}),
		...(capabilities ? { capabilities } : {}),
	};
}

function coreConfigFromLocalRuntime(
	localRuntime: LocalRuntimeStartOptions | undefined,
): Partial<BedrockCoderCoreStartConfig> {
	if (!localRuntime) {
		return {};
	}
	const {
		userInstructionService: _userInstructionService,
		configExtensions: _configExtensions,
		onTeamRestored: _onTeamRestored,
		...localConfig
	} = localRuntime;
	return localConfig;
}

function mergeLocalRuntimeStartOptions(
	...sources: Array<LocalRuntimeStartOptions | undefined>
): LocalRuntimeStartOptions | undefined {
	const merged: LocalRuntimeStartOptions = {};
	for (const source of sources) {
		if (source) {
			Object.assign(merged, source);
		}
	}
	return Object.keys(merged).length > 0 ? merged : undefined;
}
