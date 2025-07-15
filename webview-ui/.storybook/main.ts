import type { StorybookConfig } from "@storybook/react-vite"

const config: StorybookConfig = {
	stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: [],
	framework: "@storybook/react-vite",
	viteFinal: async (config) => {
		// Merge with the existing Vite config
		config.resolve = config.resolve

		// Define environment variables for Storybook
		config.define = {
			...config.define,
			"process.env": {
				NODE_ENV: JSON.stringify("development"),
				IS_DEV: JSON.stringify(true),
				IS_TEST: JSON.stringify(false),
			},
		}

		return config
	},
	typescript: {
		check: false,
		reactDocgen: "react-docgen-typescript",
		reactDocgenTypescriptOptions: {
			shouldExtractLiteralValuesFromEnum: true,
			propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
		},
	},
}
export default config
