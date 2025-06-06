const { heroui } = require("@heroui/react")

/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"],
	theme: {
		extend: {},
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
