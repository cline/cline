import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

const config: StorybookConfig = {
	stories: ["../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: ["@storybook/addon-a11y", "@storybook/addon-docs"],
	core: {
		allowedHosts: ["localhost", "127.0.0.1"],
	},
	framework: "@storybook/react-vite",
	async viteFinal(viteConfig) {
		viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];
		return viteConfig;
	},
	typescript: {
		check: true,
		reactDocgen: "react-docgen-typescript",
	},
};

export default config;
