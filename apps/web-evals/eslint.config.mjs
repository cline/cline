import { nextJsConfig } from "@roo-code/config-eslint/next-js"

/** @type {import("eslint").Linter.Config} */
export default [
	...nextJsConfig,
	{
		rules: {
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					caughtErrorsIgnorePattern: "^_",
				},
			],
		},
	},
]
