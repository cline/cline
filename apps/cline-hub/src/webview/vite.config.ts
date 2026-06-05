import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const nodeModuleChunk = (moduleId: string) => {
	if (!moduleId.includes("node_modules")) {
		return null;
	}

	if (/[\\/]node_modules[\\/](shiki|@shikijs|mermaid)[\\/]/.test(moduleId)) {
		return null;
	}
	if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(moduleId)) {
		return "vendor-react";
	}
	if (
		/[\\/]node_modules[\\/](@base-ui|@radix-ui|cmdk|lucide-react|sonner)[\\/]/.test(
			moduleId,
		)
	) {
		return "vendor-ui";
	}
	if (/[\\/]node_modules[\\/](@xyflow|recharts|d3-)[\\/]/.test(moduleId)) {
		return "vendor-visualization";
	}
	if (/[\\/]node_modules[\\/](ai|tokenlens)[\\/]/.test(moduleId)) {
		return "vendor-ai";
	}

	const packageMatch = moduleId
		.split(/[\\/]node_modules[\\/]/)
		.pop()
		?.match(/^(@[^\\/]+[\\/][^\\/]+|[^\\/]+)/);
	const packageName = packageMatch?.[1]?.replace(/[\\/@]/g, "-");
	return packageName ? `vendor-${packageName}` : "vendor";
};

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
		dedupe: ["react", "react-dom"],
	},
	base: "./",
	server: {
		cors: true,
		headers: {
			"Access-Control-Allow-Origin": "*",
		},
		hmr: {
			host: "localhost",
		},
	},
	build: {
		outDir: "../../dist/webview",
		emptyOutDir: true,
		cssMinify: "esbuild",
		chunkSizeWarningLimit: 800,
		rolldownOptions: {
			output: {
				codeSplitting: {
					groups: [
						{
							name: nodeModuleChunk,
							test: /[\\/]node_modules[\\/]/,
						},
					],
				},
			},
		},
	},
});
