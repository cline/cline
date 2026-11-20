import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
	{
		key: "Content-Security-Policy",
		value: [
			"default-src 'self'",
			"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data: blob: https:",
			"font-src 'self' data:",
			"connect-src 'self' https://*.supabase.co wss://*.supabase.co https://openrouter.ai",
			"frame-ancestors 'none'",
			"base-uri 'self'",
			"form-action 'self'",
		].join("; "),
	},
];

const nextConfig: NextConfig = {
	reactStrictMode: true,
	poweredByHeader: false,
	serverExternalPackages: ["@daytonaio/sdk"],
	experimental: {
		serverActions: { bodySizeLimit: "2mb" },
	},
	webpack(config, { isServer }) {
		if (isServer) {
			// @cline/agents is built for the Node entrypoint of @cline/llms. Next's
			// react-server condition otherwise resolves the browser build, which
			// omits the gateway and error-classification exports.
			config.resolve.alias = {
				...config.resolve.alias,
				"@cline/llms": path.join(process.cwd(), "node_modules/@cline/llms/dist/index.js"),
			};
		}
		return config;
	},
	async headers() {
		return [
			{
				source: "/:path*",
				headers: securityHeaders,
			},
		];
	},
};

export default nextConfig;
