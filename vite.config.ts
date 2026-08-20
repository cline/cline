import { cloudflare } from "@cloudflare/vite-plugin";
import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		vinext(),
		sites(),
		cloudflare({
			viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
			config: {
				main: "./worker/index.ts",
				compatibility_flags: ["nodejs_compat"],
			},
		}),
	],
});
