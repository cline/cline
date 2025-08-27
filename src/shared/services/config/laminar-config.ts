// Public Laminar key (safe for open source)
const laminarProdConfig = {
	apiKey: "",
	recordIO: true,
}

// Public Laminar key for Development Environment project
const laminarDevConfig = {
	apiKey: "",
	recordIO: true,
}

export const laminarConfig = process.env.IS_DEV === "true" ? laminarDevConfig : laminarProdConfig
