import type { StorybookConfig } from "@storybook/react-vite"

const config: StorybookConfig = {
	stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: [],
	framework: "@storybook/react-vite",
	viteFinal: async (config) => {
		// Define environment variables for Storybook
		config.define = {
			...config.define,
			"process.platform": JSON.stringify(process?.platform),
			"process.env": {
				...process.env,
				IS_DEV: JSON.stringify(true),
				IS_TEST: JSON.stringify(true),
				TEMP_PROFILE: JSON.stringify(true),
			},
		}

		return config
	},
	typescript: {
		check: true,
		reactDocgen: "react-docgen-typescript",
		reactDocgenTypescriptOptions: {
			shouldExtractLiteralValuesFromEnum: true,
			propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
		},
	},
}
export default config
