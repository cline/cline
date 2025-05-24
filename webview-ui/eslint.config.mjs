import { reactConfig } from "@roo-code/config-eslint/react"

/** @type {import("eslint").Linter.Config} */
export default [
	...reactConfig,
	{
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					args: "all",
					ignoreRestSiblings: true,
					varsIgnorePattern: "^_",
					argsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
			"@typescript-eslint/no-explicit-any": "off",
			"react/prop-types": "off",
			"react/display-name": "off",
		},
	},
	{
		files: ["src/components/chat/ChatRow.tsx", "src/components/settings/ModelInfoView.tsx"],
		rules: {
			"react/jsx-key": "off",
		},
	},
	{
		files: [
			"src/components/chat/ChatRow.tsx",
			"src/components/chat/ChatView.tsx",
			"src/components/chat/BrowserSessionRow.tsx",
			"src/components/history/useTaskSearch.ts",
		],
		rules: {
			"no-case-declarations": "off",
		},
	},
	{
		files: ["src/__mocks__/**/*.js"],
		rules: {
			"no-undef": "off",
		},
	},
]
