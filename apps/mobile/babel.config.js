module.exports = (api) => {
	api.cache.using(() => process.env.EXPO_PUBLIC_ENV);
	const environment = process.env.EXPO_PUBLIC_ENV;
	if (
		api.env("production") &&
		environment !== "production" &&
		environment !== "staging"
	) {
		throw new Error(
			"Release builds require EXPO_PUBLIC_ENV=production or staging",
		);
	}
	return {
		presets: [["babel-preset-expo", { jsxImportSource: "react" }]],
	};
};
