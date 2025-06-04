import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	webpack: (config) => {
		config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js", ".jsx"] }
		return config
	},
}

export default nextConfig
