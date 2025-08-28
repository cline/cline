// Public Laminar key
const laminarProdConfig = {
	apiKey: "",
	recordIO: true,
	enabled: true,
}

// Public Laminar key for Development Environment project
const laminarDevConfig = {
	apiKey: "",
	recordIO: true,
	enabled: true,
}

export const laminarConfig = process.env.IS_DEV === "true" ? laminarDevConfig : laminarProdConfig
