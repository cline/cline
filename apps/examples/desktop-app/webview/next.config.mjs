import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(__dirname, "../../../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "export",
	outputFileTracingRoot: workspaceRoot,
	turbopack: {
		root: workspaceRoot,
	},
	// Dev-only: Next blocks HMR/font/dev-resource requests from origins that
	// don't match the dev server's own hostname. Both loopback spellings are
	// legitimate ways to reach a local or port-forwarded dev server.
	allowedDevOrigins: ["localhost", "127.0.0.1"],
	reactStrictMode: true,
	typescript: {
		ignoreBuildErrors: true,
	},
	images: {
		unoptimized: true,
	},
};

export default nextConfig;
