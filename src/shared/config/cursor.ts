export const CursorConfig = {
	// Message size limits
	MAX_MESSAGE_SIZE: 4294967296, // 4GB (2^32 bytes) per spec

	// Token management
	TOKEN_EXPIRY: 3600000, // 1 hour in milliseconds
	TOKEN_REFRESH_THRESHOLD: 300000, // 5 minutes in milliseconds
	TOKEN_REFRESH_INTERVAL: 3300000, // 55 minutes in milliseconds
	TOKEN_VALIDITY: 3600000, // 1 hour in milliseconds

	// API configuration
	API_ENDPOINT: "https://api2.cursor.sh/aiserver.v1.AiService/StreamChat",
	TOKEN_REFRESH_ENDPOINT: "https://cursor.sh/api/refresh",
	CLIENT_ID: "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB",
	CLIENT_KEY: "", // Will be set dynamically at extension startup
	CLIENT_CHECKSUM:
		"LwoMGZe259957470509b69c0a477232e090cae43695725138dedbcc7625a2b36573caa58/deb3cac1988ff56ea6fabce72eefd291235ab451eef8173567d7521126673b73",
	CLIENT_VERSION: "0.45.11",
	USER_AGENT:
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/0.45.11 Chrome/128.0.6613.186 Electron/32.2.6 Safari/537.36",

	// Storage keys
	STORAGE_KEYS: {
		ACCESS_TOKEN: "cursorAccessToken",
		REFRESH_TOKEN: "cursorRefreshToken",
	},
} as const

// Type for the config to ensure type safety
export type CursorConfigType = typeof CursorConfig
