import { config } from "@roo-code/config-eslint/base"

/** @type {import("eslint").Linter.Config} */
export default [
	...config,
	{
		rules: {
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
	{
		files: ["i18n/setup.ts", "utils/tts.ts"],
		rules: {
			"@typescript-eslint/no-require-imports": "off",
		},
	},
	{
		files: ["shared/support-prompt.ts"],
		rules: {
			"no-prototype-builtins": "off",
		},
	},
	{
		files: ["shared/combineApiRequests.ts", "utils/tts.ts"],
		rules: {
			"no-empty": "off",
		},
	},
]
