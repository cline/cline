const { heroui } = require("@heroui/react")

/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"],
	theme: {
		extend: {
			fontFamily: {
				"azeret-mono": ['"Azeret Mono"', "monospace"],
			},
		},
	},
	darkMode: "class",
	plugins: [
		heroui({
			defaultTheme: "vscode",
			themes: {
				vscode: {
					colors: {
						background: "",
					},
				},
			},
		}),
	],
}
