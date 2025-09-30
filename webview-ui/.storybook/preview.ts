import type { Preview } from "@storybook/react-vite"
import "../src/index.css" // Import Tailwind CSS and other global styles
import { StorybookWebview } from "../src/config/StorybookDecorator"

const preview: Preview = {
	parameters: {
		viewport: {
			viewports: {
				"Editor Sidebar": {
					name: "Editor Sidebar",
					styles: { width: "700px", height: "800px" },
					type: "desktop",
				},
			},
			defaultViewport: "Editor Sidebar",
		},
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		docs: {
			theme: {
				base: "dark",
				colorPrimary: "#3794ff",
				colorSecondary: "#0e639c",
				appBg: "#1e1e1e",
				appContentBg: "#252526",
				textColor: "#d4d4d4",
			},
		},
		layout: "padded",
	},
	decorators: [StorybookWebview],
	globalTypes: {
		theme: {
			description: "Color Themes",
			defaultValue: "vs_dark",
			toolbar: {
				dynamicTitle: true,
				icon: "sun",
				title: "Themes",
				items: [
					{ value: "vs_dark", title: "VS Code Dark" },
					{ value: "vs_light", title: "VS Code Light" },
				],
			},
		},
	},
}

export default preview
