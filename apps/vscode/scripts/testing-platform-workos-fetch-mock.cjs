// Preload used by the standalone testing platform.
// It makes the SDK WorkOS device-auth flow deterministic and fully local while
// leaving production auth code on the same device-auth path used by users.

const originalFetch = globalThis.fetch?.bind(globalThis)

const WORKOS_ORIGIN = "https://api.workos.com"
const DEVICE_CODE = "test-device-code"
const USER_CODE = "PTBC-TXTP"
const ACCESS_TOKEN = "test-personal-token"
const REFRESH_TOKEN = "test-personal-token_refresh"

function jsonResponse(body, init = {}) {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
	})
}

function inputUrl(input) {
	if (typeof input === "string") return input
	if (input instanceof URL) return input.toString()
	if (input && typeof input === "object" && "url" in input) return input.url
	return String(input)
}

globalThis.fetch = async (input, init) => {
	const urlString = inputUrl(input)
	let url
	try {
		url = new URL(urlString)
	} catch {
		return originalFetch(input, init)
	}

	if (url.origin === WORKOS_ORIGIN && url.pathname === "/user_management/authorize/device") {
		return jsonResponse({
			device_code: DEVICE_CODE,
			user_code: USER_CODE,
			verification_uri: "https://login.workos.test/device",
			verification_uri_complete: `https://login.workos.test/device?user_code=${USER_CODE}`,
			expires_in: 300,
			interval: 1,
		})
	}

	if (url.origin === WORKOS_ORIGIN && url.pathname === "/user_management/authenticate") {
		return jsonResponse({
			access_token: ACCESS_TOKEN,
			refresh_token: REFRESH_TOKEN,
			token_type: "Bearer",
		})
	}

	return originalFetch(input, init)
}
