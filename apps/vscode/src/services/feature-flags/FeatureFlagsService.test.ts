import { describe, expect, it, mock } from "bun:test"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import type { FeatureFlagsAndPayloads, FeatureFlagsSettings, IFeatureFlagsProvider } from "./providers/IFeatureFlagsProvider"

mock.module("@/core/controller/models/getClineOnboardingModels", () => ({
	clearOnboardingModelsCache: () => undefined,
	getClineOnboardingModels: () => undefined,
}))

mock.module("../telemetry", () => ({
	telemetryService: { capture: () => undefined },
}))

type PendingPoll = {
	distinctId?: string
	resolve: (value: FeatureFlagsAndPayloads) => void
}

class DeferredFeatureFlagsProvider implements IFeatureFlagsProvider {
	readonly pending: PendingPoll[] = []

	getAllFlagsAndPayloads(options: { distinctId?: string }): Promise<FeatureFlagsAndPayloads | undefined> {
		return new Promise((resolve) => {
			this.pending.push({ distinctId: options.distinctId, resolve })
		})
	}

	isEnabled(): boolean {
		return true
	}

	getSettings(): FeatureFlagsSettings {
		return { enabled: true }
	}

	async dispose(): Promise<void> {}
}

describe("FeatureFlagsService", () => {
	it("keeps the authenticated result when an older anonymous poll resolves last", async () => {
		const { FeatureFlagsService } = await import("./FeatureFlagsService")
		const provider = new DeferredFeatureFlagsProvider()
		const service = new FeatureFlagsService(provider)

		const anonymousPoll = service.poll(null)
		const authenticatedPoll = service.poll("account-123")

		expect(provider.pending.map((request) => request.distinctId)).toEqual([undefined, "account-123"])

		provider.pending[1].resolve({ featureFlags: { [FeatureFlag.CLOUD_SESSIONS]: true } })
		await authenticatedPoll
		expect(service.getBooleanFlagEnabled(FeatureFlag.CLOUD_SESSIONS)).toBe(true)

		provider.pending[0].resolve({ featureFlags: { [FeatureFlag.CLOUD_SESSIONS]: false } })
		await anonymousPoll
		expect(service.getBooleanFlagEnabled(FeatureFlag.CLOUD_SESSIONS)).toBe(true)
	})
})
