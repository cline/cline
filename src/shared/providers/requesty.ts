const REQUESTY_BASE_URL = "https://router.requesty.ai/v1"

type URLType = "router" | "app" | "api"

const replaceCname = (baseUrl: string, type: URLType): string => {
	if (type === "router") {
		return baseUrl
	} else {
		return baseUrl.replace("router", type).replace("v1", "")
	}
}

export const toRequestyServiceUrl = (baseUrl?: string, service: URLType = "router"): URL => {
	const url = replaceCname(baseUrl ?? REQUESTY_BASE_URL, service)

	return new URL(url)
}

export const toRequestyServiceStringUrl = (baseUrl?: string, service: URLType = "router"): string => {
	return toRequestyServiceUrl(baseUrl, service).toString()
}
