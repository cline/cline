import { reactConfig } from "@roo-code/config-eslint/react"

/** @type {import("eslint").Linter.Config} */
export default [
	...reactConfig,
	{
		rules: {
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
	{
		files: ["src/utils/context-mentions.ts", "src/utils/highlighter.ts"],
		rules: {
			"prefer-const": "off",
		},
	},
]
