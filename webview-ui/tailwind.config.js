/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
	theme: {
		extend: {
			fontFamily: {
				"azeret-mono": ['"Azeret Mono"', "monospace"],
			},
		},
	},
	// Toggle dark-mode based on .dark class or data-mode="dark"
	darkMode: ["class", '[data-mode="dark"]', '[class="vs-dark"]'],
}
