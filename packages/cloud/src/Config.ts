// Production constants
export const PRODUCTION_CLERK_BASE_URL = "https://clerk.roocode.com"
export const PRODUCTION_ROO_CODE_API_URL = "https://app.roocode.com"

// Functions with environment variable fallbacks
export const getClerkBaseUrl = () => process.env.CLERK_BASE_URL || PRODUCTION_CLERK_BASE_URL
export const getRooCodeApiUrl = () => process.env.ROO_CODE_API_URL || PRODUCTION_ROO_CODE_API_URL
