import { fetch } from "@/shared/net"
import { GITHUB_COPILOT_CLIENT_ID } from "./github-copilot"

interface DeviceCodeResponse {
	verification_uri: string
	user_code: string
	device_code: string
	interval: number
	expires_in: number
}

interface AccessTokenResponse {
	access_token?: string
	error?: string
	error_description?: string
}

export interface GitHubCopilotAuthResult {
	success: boolean
	accessToken?: string
	error?: string
}

function getAuthUrls(enterpriseUrl?: string) {
	if (enterpriseUrl) {
		const domain = enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
		return {
			deviceCodeUrl: `https://${domain}/login/device/code`,
			accessTokenUrl: `https://${domain}/login/oauth/access_token`,
		}
	}
	return {
		deviceCodeUrl: "https://github.com/login/device/code",
		accessTokenUrl: "https://github.com/login/oauth/access_token",
	}
}

/**
 * Initiates the GitHub device code OAuth flow.
 * Returns the device code response with the verification URL and user code.
 */
export async function initiateDeviceCodeFlow(enterpriseUrl?: string): Promise<{
	verificationUri: string
	userCode: string
	deviceCode: string
	interval: number
	expiresIn: number
}> {
	const urls = getAuthUrls(enterpriseUrl)

	const response = await fetch(urls.deviceCodeUrl, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"User-Agent": "cline/1.0",
		},
		body: JSON.stringify({
			client_id: GITHUB_COPILOT_CLIENT_ID,
			scope: "read:user",
		}),
	})

	if (!response.ok) {
		throw new Error(`Failed to initiate device authorization: ${response.status} ${response.statusText}`)
	}

	const data = (await response.json()) as DeviceCodeResponse

	return {
		verificationUri: data.verification_uri,
		userCode: data.user_code,
		deviceCode: data.device_code,
		interval: data.interval,
		expiresIn: data.expires_in,
	}
}

/**
 * Polls for the access token after the user has authorized the device.
 * Should be called repeatedly with the device code until an access token is received or an error occurs.
 */
export async function pollForAccessToken(
	deviceCode: string,
	enterpriseUrl?: string
): Promise<{ status: "pending" | "success" | "failed"; accessToken?: string; error?: string }> {
	const urls = getAuthUrls(enterpriseUrl)

	const response = await fetch(urls.accessTokenUrl, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"User-Agent": "cline/1.0",
		},
		body: JSON.stringify({
			client_id: GITHUB_COPILOT_CLIENT_ID,
			device_code: deviceCode,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		}),
	})

	if (!response.ok) {
		return { status: "failed", error: `HTTP ${response.status}: ${response.statusText}` }
	}

	const data = (await response.json()) as AccessTokenResponse

	if (data.access_token) {
		return { status: "success", accessToken: data.access_token }
	}

	if (data.error === "authorization_pending") {
		return { status: "pending" }
	}

	if (data.error) {
		return { status: "failed", error: data.error_description || data.error }
	}

	return { status: "pending" }
}

/**
 * Complete OAuth flow - polls until success, failure, or timeout.
 * This is a convenience function that handles the polling loop.
 */
export async function completeDeviceCodeFlow(
	deviceCode: string,
	interval: number,
	expiresIn: number,
	enterpriseUrl?: string,
	onProgress?: (message: string) => void
): Promise<GitHubCopilotAuthResult> {
	const startTime = Date.now()
	const expiresAt = startTime + expiresIn * 1000

	while (Date.now() < expiresAt) {
		await new Promise((resolve) => setTimeout(resolve, interval * 1000))

		onProgress?.("Waiting for authorization...")

		const result = await pollForAccessToken(deviceCode, enterpriseUrl)

		if (result.status === "success" && result.accessToken) {
			return { success: true, accessToken: result.accessToken }
		}

		if (result.status === "failed") {
			return { success: false, error: result.error }
		}

		// status === "pending", continue polling
	}

	return { success: false, error: "Authorization timed out. Please try again." }
}
