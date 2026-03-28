import { expect } from "chai"
import { describe, it } from "mocha"
import type { ApiConfiguration } from "@shared/api"
import type { Secrets, Settings } from "@shared/storage/state-keys"
import { RuntimeConfigFacade } from "../runtime-config-facade"

const createStateWriter = () => {
	const apiConfigurations: ApiConfiguration[] = []
	const globalStateUpdates: Array<{ key: keyof Settings; value: Settings[keyof Settings] }> = []
	const settings: Partial<Settings> = {}
	const secrets: Partial<Secrets> = {}

	return {
		apiConfigurations,
		globalStateUpdates,
		writer: {
			getApiConfiguration: () => (apiConfigurations[apiConfigurations.length - 1] ?? {}) as ApiConfiguration,
			getGlobalSettingsKey: (key: keyof Settings) => settings[key],
			getSecretKey: (key: keyof Secrets) => secrets[key],
			setApiConfiguration: (apiConfiguration: ApiConfiguration) => {
				apiConfigurations.push(apiConfiguration)
				Object.assign(settings, apiConfiguration)
				Object.assign(secrets, apiConfiguration)
			},
			setGlobalState: (key: keyof Settings, value: Settings[keyof Settings]) => {
				globalStateUpdates.push({ key, value })
				settings[key] = value
			},
		},
	}
}

describe("RuntimeConfigFacade", () => {
	it("writes legacy provider configuration through runtime-aware mutation rules", () => {
		const facade = new RuntimeConfigFacade()
		const state = createStateWriter()

		const mutation = facade.writeLegacyProviderConfig(state.writer as any, {
			providerId: "claude-code",
			modelId: "claude-sonnet",
			apiKey: "unused",
			source: "cli",
		})

		expect(mutation.runtimeId).to.equal("claude-code")
		expect(state.apiConfigurations).to.have.length(1)
		expect(state.apiConfigurations[0].actModeApiProvider).to.equal("claude-code")
		expect(state.apiConfigurations[0].planModeApiProvider).to.equal("claude-code")
		expect(state.apiConfigurations[0].actModeApiModelId).to.equal("claude-sonnet")
		expect(state.apiConfigurations[0].planModeApiModelId).to.equal("claude-sonnet")
	})

	it("reads provider and model selection in provider/model format", () => {
		const facade = new RuntimeConfigFacade()
		const state = createStateWriter()
		state.writer.setGlobalState("actModeApiProvider", "claude-code")
		state.writer.setGlobalState("actModeApiModelId", "claude-sonnet")

		const selection = facade.readLegacyModelSelection(state.writer as any, "act")

		expect(selection.runtimeId).to.equal("claude-code")
		expect(selection.provider).to.equal("claude-code")
		expect(selection.modelId).to.equal("claude-sonnet")
		expect(selection.fullModelId).to.equal("claude-code/claude-sonnet")
	})
})
