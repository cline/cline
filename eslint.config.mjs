import tseslint from "typescript-eslint"
import eslintConfigPrettier from "eslint-config-prettier"

export default [
	{
		ignores: ["**/out", "**/dist", "**/*.d.ts"],
	},
	...tseslint.configs.recommended,
	{
		plugins: {},
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			ecmaVersion: 6,
			sourceType: "module",
		},
		rules: {
			"@typescript-eslint/naming-convention": [
				"warn",
				{
					selector: "import",
					format: ["camelCase", "PascalCase"],
				},
			],
			"@typescript-eslint/semi": "off",
			curly: "warn",
			eqeqeq: "warn",
			"no-throw-literal": "warn",
			semi: "off",
			"react-hooks/exhaustive-deps": "off",
		},
	},
	eslintConfigPrettier,
]
