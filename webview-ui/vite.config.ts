import { resolve } from "path"
import fs from "fs"

import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

function wasmPlugin(): Plugin {
	return {
		name: "wasm",
		async load(id: string) {
			if (id.endsWith(".wasm")) {
				const wasmBinary = await import(id)

				return `
          			const wasmModule = new WebAssembly.Module(${wasmBinary.default});
          			export default wasmModule;
        		`
			}
		},
	}
}

// Custom plugin to write the server port to a file
const writePortToFile = () => {
	return {
		name: "write-port-to-file",
		configureServer(server) {
			// Write the port to a file when the server starts
			server.httpServer?.once("listening", () => {
				const address = server.httpServer.address()
				const port = typeof address === "object" && address ? address.port : null

				if (port) {
					// Write to a file in the project root
					const portFilePath = resolve(__dirname, "../.vite-port")
					fs.writeFileSync(portFilePath, port.toString())
					console.log(`[Vite Plugin] Server started on port ${port}`)
					console.log(`[Vite Plugin] Port information written to ${portFilePath}`)
				} else {
					console.warn("[Vite Plugin] Could not determine server port")
				}
			})
		},
	}
}

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss(), writePortToFile(), wasmPlugin()],
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
			"@src": resolve(__dirname, "./src"),
			"@roo": resolve(__dirname, "../src"),
		},
	},
	build: {
		outDir: "build",
		reportCompressedSize: false,
		rollupOptions: {
			output: {
				entryFileNames: `assets/[name].js`,
				chunkFileNames: `assets/[name].js`,
				assetFileNames: `assets/[name].[ext]`,
			},
		},
	},
	server: {
		hmr: {
			host: "localhost",
			protocol: "ws",
		},
		cors: {
			origin: "*",
			methods: "*",
			allowedHeaders: "*",
		},
	},
	define: {
		"process.platform": JSON.stringify(process.platform),
		"process.env.VSCODE_TEXTMATE_DEBUG": JSON.stringify(process.env.VSCODE_TEXTMATE_DEBUG),
	},
	optimizeDeps: {
		exclude: ["@vscode/codicons", "vscode-oniguruma", "shiki"],
	},
	assetsInclude: ["**/*.wasm"],
})
