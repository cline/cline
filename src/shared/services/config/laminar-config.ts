// Public Laminar key (safe for open source)
const laminarProdConfig = {
	apiKey: "",
	recordInputs: true,
}

// Public Laminar key for Development Environment project
const laminarDevConfig = {
	apiKey: "",
	recordInputs: true,
}

export const laminarConfig = process.env.IS_DEV === "true" ? laminarDevConfig : laminarProdConfig
