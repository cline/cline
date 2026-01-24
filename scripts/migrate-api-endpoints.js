#!/usr/bin/env node

/**
 * Migration Script for API Endpoints
 *
 * This script provides guidance for updating all API providers to use
 * the centralized API endpoints configuration.
 */

const providersToUpdate = [
	{
		file: "deepseek.ts",
		provider: "deepseek",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: "baseURL: this.options.deepSeekBaseUrl",
				replace: "baseURL: this.options.deepSeekBaseUrl || getDefaultBaseUrl('deepseek')",
			},
		],
	},
	{
		file: "mistral.ts",
		provider: "mistral",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: "baseURL: this.options.mistralBaseUrl",
				replace: "baseURL: this.options.mistralBaseUrl || getDefaultBaseUrl('mistral')",
			},
		],
	},
	{
		file: "litellm.ts",
		provider: "litellm",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: "baseURL: this.options.liteLlmBaseUrl",
				replace: "baseURL: this.options.liteLlmBaseUrl || getDefaultBaseUrl('litellm')",
			},
		],
	},
	{
		file: "lmstudio.ts",
		provider: "lmstudio",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: "baseURL: this.options.lmStudioBaseUrl",
				replace: "baseURL: this.options.lmStudioBaseUrl || getDefaultBaseUrl('lmstudio')",
			},
		],
	},
	{
		file: "openrouter.ts",
		provider: "openrouter",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://openrouter.ai/api/v1"',
				replace: "baseURL: getDefaultBaseUrl('openrouter')",
			},
		],
	},
	{
		file: "xai.ts",
		provider: "xai",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://api.x.ai/v1"',
				replace: "baseURL: getDefaultBaseUrl('xai')",
			},
		],
	},
	{
		file: "groq.ts",
		provider: "groq",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://api.groq.com/openai/v1"',
				replace: "baseURL: getDefaultBaseUrl('groq')",
			},
		],
	},
	{
		file: "cerebras.ts",
		provider: "cerebras",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://api.cerebras.ai/v1"',
				replace: "baseURL: getDefaultBaseUrl('cerebras')",
			},
		],
	},
	{
		file: "sambanova.ts",
		provider: "sambanova",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://api.sambanova.ai/v1"',
				replace: "baseURL: getDefaultBaseUrl('sambanova')",
			},
		],
	},
	{
		file: "nebius.ts",
		provider: "nebius",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://api.studio.nebius.ai/v1"',
				replace: "baseURL: getDefaultBaseUrl('nebius')",
			},
		],
	},
	{
		file: "fireworks.ts",
		provider: "fireworks",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://api.fireworks.ai/inference/v1"',
				replace: "baseURL: getDefaultBaseUrl('fireworks')",
			},
		],
	},
	{
		file: "together.ts",
		provider: "together",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://api.together.xyz/v1"',
				replace: "baseURL: getDefaultBaseUrl('together')",
			},
		],
	},
	{
		file: "asksage.ts",
		provider: "asksage",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: "baseURL: this.options.asksageApiUrl",
				replace: "baseURL: this.options.asksageApiUrl || getDefaultBaseUrl('asksage')",
			},
		],
	},
	{
		file: "requesty.ts",
		provider: "requesty",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: "baseURL: this.options.requestyBaseUrl",
				replace: "baseURL: this.options.requestyBaseUrl || getDefaultBaseUrl('requesty')",
			},
		],
	},
	{
		file: "qwen.ts",
		provider: "qwen",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: qwenApiLine === QwenApiRegions.INTERNATIONAL ? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" : "https://dashscope.aliyuncs.com/compatible-mode/v1"',
				replace:
					"baseURL: getDefaultBaseUrl('qwen', qwenApiLine === QwenApiRegions.INTERNATIONAL ? 'international' : 'china')",
			},
		],
	},
	{
		file: "moonshot.ts",
		provider: "moonshot",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://api.moonshot.cn/v1"',
				replace: "baseURL: getDefaultBaseUrl('moonshot', this.options.moonshotApiLine)",
			},
		],
	},
	{
		file: "zai.ts",
		provider: "zai",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://open.bigmodel.cn/api/paas/v4"',
				replace: "baseURL: getDefaultBaseUrl('zai', this.options.zaiApiLine)",
			},
		],
	},
	{
		file: "minimax.ts",
		provider: "minimax",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://api.minimax.chat/v1"',
				replace: "baseURL: getDefaultBaseUrl('minimax', this.options.minimaxApiLine)",
			},
		],
	},
	{
		file: "oca.ts",
		provider: "oca",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: "baseURL: this.options.ocaBaseUrl",
				replace: "baseURL: this.options.ocaBaseUrl || getDefaultBaseUrl('oca', this.options.ocaMode)",
			},
		],
	},
	{
		file: "dify.ts",
		provider: "dify",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: "baseURL: this.options.difyBaseUrl",
				replace: "baseURL: this.options.difyBaseUrl || getDefaultBaseUrl('dify')",
			},
		],
	},
	{
		file: "cline.ts",
		provider: "cline",
		import: "import { getDefaultBaseUrl } from '@shared/api-endpoints'",
		changes: [
			{
				find: 'baseURL: "https://api.cline.bot/v1"',
				replace: "baseURL: getDefaultBaseUrl('cline')",
			},
		],
	},
]

console.log("API Endpoints Migration Guide")
console.log("==============================\n")
console.log("The following providers need to be updated:\n")

providersToUpdate.forEach((provider, index) => {
	console.log(`${index + 1}. ${provider.file} (${provider.provider})`)
	console.log(`   Import: ${provider.import}`)
	provider.changes.forEach((change, i) => {
		console.log(`   Change ${i + 1}:`)
		console.log(`     Find: ${change.find}`)
		console.log(`     Replace: ${change.replace}`)
	})
	console.log("")
})

console.log("\nCompleted providers:")
console.log("- anthropic.ts ✓")
console.log("- openai.ts ✓")
console.log("- ollama.ts ✓")
console.log("- gemini.ts ✓")

console.log("\nTotal providers to update:", providersToUpdate.length)
console.log("Total providers completed: 4")
console.log("Remaining:", providersToUpdate.length)
