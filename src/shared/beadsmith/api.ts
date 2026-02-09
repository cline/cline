enum BEADSMITH_API_AUTH_ENDPOINTS {
	AUTH = "/api/v1/auth/authorize",
	REFRESH_TOKEN = "/api/v1/auth/refresh",
}

enum BEADSMITH_API_ENDPOINT_V1 {
	TOKEN_EXCHANGE = "/api/v1/auth/token",
	USER_INFO = "/api/v1/users/me",
	ACTIVE_ACCOUNT = "/api/v1/users/active-account",
	REMOTE_CONFIG = "/api/v1/organizations/{id}/remote-config",
	API_KEYS = "/api/v1/organizations/{id}/api-keys",
}

export const BEADSMITH_API_ENDPOINT = {
	...BEADSMITH_API_AUTH_ENDPOINTS,
	...BEADSMITH_API_ENDPOINT_V1,
}
