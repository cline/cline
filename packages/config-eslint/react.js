import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import typescriptEslint from "typescript-eslint"
import pluginReactHooks from "eslint-plugin-react-hooks"
import pluginReact from "eslint-plugin-react"
import globals from "globals"

import { config } from "./base.js"

/**
 * @type {import("eslint").Linter.Config[]}
 */
export const reactConfig = [
	...config,
	js.configs.recommended,
	eslintConfigPrettier,
	...typescriptEslint.configs.recommended,
	{
		...pluginReact.configs.flat.recommended,
		languageOptions: {
			...pluginReact.configs.flat.recommended.languageOptions,
			globals: {
				...globals.serviceworker,
			},
		},
	},
	{
		plugins: {
			"react-hooks": pluginReactHooks,
		},
		settings: { react: { version: "detect" } },
		rules: {
			...pluginReactHooks.configs.recommended.rules,
			// React scope no longer necessary with new JSX transform.
			"react/react-in-jsx-scope": "off",
		},
	},
]
