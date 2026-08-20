/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "export",
	outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
	turbopack: { root: new URL("../..", import.meta.url).pathname },
	transpilePackages: ["@cline/ui", "@cline/shared"],
	typescript: { ignoreBuildErrors: true },
	images: { unoptimized: true },
};

export default nextConfig;
