enum CLINE_API_ENDPOINT_AUTH {
	AUTH = "auth/authorize",
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
}

export const CLINE_API_ENDPOINT = {
	...CLINE_API_ENDPOINT_AUTH,
	...CLINE_API_ENDPOINT_V1,
}
