import type {
	FeatureFlagsAndPayloads,
	FeatureFlagsSettings,
	IFeatureFlagsProvider,
} from "@cline/shared";

export class NoOpFeatureFlagsProvider implements IFeatureFlagsProvider {
	async getAllFlagsAndPayloads(): Promise<FeatureFlagsAndPayloads> {
		return {};
	}

	enabled = false;

	getSettings(): FeatureFlagsSettings {
		return { enabled: false, timeoutMs: 1000 };
	}

	async dispose(): Promise<void> {}
}
