import type {
	FeatureFlagsAndPayloads,
	FeatureFlagsSettings,
	IFeatureFlagsProvider,
} from "@cline/shared";

export class NoOpFeatureFlagsProvider implements IFeatureFlagsProvider {
	async getAllFlagsAndPayloads(): Promise<FeatureFlagsAndPayloads> {
		return {};
	}

	isEnabled(): boolean {
		return false;
	}

	getSettings(): FeatureFlagsSettings {
		return { enabled: false, timeout: 1000 };
	}

	async dispose(): Promise<void> {}
}
