enum CLINE_API_ENDPOINT_AUTH {
	AUTH = "auth/authorize",
	REFRESH_TOKEN = "/api/v1/auth/refresh",
}

enum CLINE_API_ENDPOINT_V1 {
	/**
	 * POST /api/v1/auth/token
	 * Body:
	 * - code: Authorization code from callback (required)
	 * - grant_type: "authorization_code" (required)
	 */
	TOKEN_EXCHANGE = "/api/v1/auth/token",
	USER_INFO = "/api/v1/users/me",
	ACTIVE_ACCOUNT = "/api/v1/users/active-account",
}

export const CLINE_API_ENDPOINT = {
	...CLINE_API_ENDPOINT_AUTH,
	...CLINE_API_ENDPOINT_V1,
}
