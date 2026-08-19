import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);

/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "export",
	devIndicators: false,
	outputFileTracingRoot: workspaceRoot,
	turbopack: {
		root: workspaceRoot,
	},
	allowedDevOrigins: ["localhost", "127.0.0.1"],
	reactStrictMode: true,
	images: {
		unoptimized: true,
	},
};

export default nextConfig;
