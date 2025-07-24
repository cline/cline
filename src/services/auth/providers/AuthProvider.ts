import { ExtensionContext } from "vscode"
import { ClineAuthInfo } from "../AuthService"

/**
 * Abstract base class for authentication providers.
 * All auth providers should extend this class and implement the required methods.
 */
export abstract class AuthProvider {
	/**
	 * Map to hold registered authentication providers.
	 */
	public static readonly registry: Map<string, AuthProvider> = new Map()

	protected _config: any

	constructor(config: any) {
		this._config = config || {}
	}

	/**
	 * Gets the current configuration for the auth provider
	 */
	get config(): any {
		return this._config
	}

	/**
	 * Sets the configuration for the auth provider
	 */
	set config(value: any) {
		this._config = value
	}

	/**
	 * Determines if an existing ID token should be refreshed based on expiration time
	 * @param existingIdToken - The current ID token to check
	 * @returns Promise<boolean> - True if the token should be refreshed
	 */
	abstract shouldRefreshIdToken(existingIdToken: string): Promise<boolean>

	/**
	 * Retrieves authentication information for the current user from stored credentials
	 * @param context - VSCode extension context for accessing secure storage
	 * @returns Promise<ClineAuthInfo | null> - Authentication info or null if not authenticated
	 */
	abstract retrieveClineAuthInfo(context: ExtensionContext): Promise<ClineAuthInfo | null>

	/**
	 * Signs in a user using the provider's authentication system
	 * @param context - VSCode extension context for storing credentials
	 * @param token - Authentication token from the OAuth provider
	 * @param provider - The OAuth provider name (e.g., 'google', 'github')
	 * @returns Promise<ClineAuthInfo | null> - Authentication info or null if sign-in failed
	 */
	abstract signIn(context: ExtensionContext, token: string, provider: string): Promise<ClineAuthInfo | null>
}
