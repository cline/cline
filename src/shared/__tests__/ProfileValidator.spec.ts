// npx vitest run src/shared/__tests__/ProfileValidator.spec.ts

import { OrganizationAllowList, ProviderSettings } from "@roo-code/types"

import { ProfileValidator } from "../ProfileValidator"

describe("ProfileValidator", () => {
	describe("isProfileAllowed", () => {
		it("should allow any profile when allowAll is true", () => {
			const allowList: OrganizationAllowList = {
				allowAll: true,
				providers: {},
			}
			const profile: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "gpt-4",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should reject profiles without an apiProvider", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					openai: { allowAll: true },
				},
			}
			const profile: Partial<ProviderSettings> = {}

			expect(ProfileValidator.isProfileAllowed(profile as ProviderSettings, allowList)).toBe(false)
		})

		it("should reject profiles with provider not in allow list", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					anthropic: { allowAll: true },
					gemini: { allowAll: false, models: ["gemini-pro"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "gpt-4",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(false)
		})

		it("should allow human-relay provider regardless of model", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					"human-relay": { allowAll: false },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "human-relay",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should allow providers with allowAll=true regardless of model", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					openai: { allowAll: true },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "any-model-id",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should reject if provider exists but model ID is missing", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					openai: { allowAll: false, models: ["gpt-4"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "openai",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(false)
		})

		it("should allow if model is in the allowed models list", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					openai: { allowAll: false, models: ["gpt-3.5-turbo", "gpt-4"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "gpt-4",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should reject if model is not in the allowed models list", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					openai: { allowAll: false, models: ["gpt-3.5-turbo"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "gpt-4",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(false)
		})

		it("should handle undefined models array in provider config", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					openai: { allowAll: false },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "gpt-4",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(false)
		})

		it("should extract openAiModelId for openai provider", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					openai: { allowAll: false, models: ["gpt-4"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "gpt-4",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should extract apiModelId for anthropic provider", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					anthropic: { allowAll: false, models: ["claude-3-opus"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "anthropic",
				apiModelId: "claude-3-opus",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should extract ollamaModelId for ollama provider", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					ollama: { allowAll: false, models: ["llama3"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "ollama",
				ollamaModelId: "llama3",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		// Test specific providers that use apiModelId
		const apiModelProviders = [
			"anthropic",
			"openai-native",
			"bedrock",
			"vertex",
			"gemini",
			"mistral",
			"deepseek",
			"xai",
			"groq",
			"chutes",
		]

		apiModelProviders.forEach((provider) => {
			it(`should extract apiModelId for ${provider} provider`, () => {
				const allowList: OrganizationAllowList = {
					allowAll: false,
					providers: {
						[provider]: { allowAll: false, models: ["test-model"] },
					},
				}
				const profile: ProviderSettings = {
					apiProvider: provider as any, // Type assertion needed here
					apiModelId: "test-model",
				}

				expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
			})
		})

		// Test for litellm provider which uses litellmModelId
		it(`should extract litellmModelId for litellm provider`, () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					litellm: { allowAll: false, models: ["test-model"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "litellm" as any,
				litellmModelId: "test-model",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should extract vsCodeLmModelSelector.id for vscode-lm provider", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					"vscode-lm": { allowAll: false, models: ["copilot-gpt-3.5"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "vscode-lm",
				vsCodeLmModelSelector: { id: "copilot-gpt-3.5" },
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should extract unboundModelId for unbound provider", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					unbound: { allowAll: false, models: ["unbound-model"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "unbound",
				unboundModelId: "unbound-model",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should extract lmStudioModelId for lmstudio provider", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					lmstudio: { allowAll: false, models: ["lmstudio-model"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "lmstudio",
				lmStudioModelId: "lmstudio-model",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should extract openRouterModelId for openrouter provider", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					openrouter: { allowAll: false, models: ["openrouter-model"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "openrouter-model",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should extract glamaModelId for glama provider", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					glama: { allowAll: false, models: ["glama-model"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "glama",
				glamaModelId: "glama-model",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should extract requestyModelId for requesty provider", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					requesty: { allowAll: false, models: ["requesty-model"] },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "requesty",
				requestyModelId: "requesty-model",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(true)
		})

		it("should handle providers with undefined models list gracefully", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					"fake-ai": { allowAll: false },
				},
			}
			const profile: ProviderSettings = {
				apiProvider: "fake-ai",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(false)
		})

		it("should handle empty providers object", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {},
			}
			const profile: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "gpt-4",
			}

			expect(ProfileValidator.isProfileAllowed(profile, allowList)).toBe(false)
		})
	})
})
