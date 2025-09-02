import type { Controller } from "@/core/controller"
import { AuthService } from "@/services/auth/AuthService"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"

/**
 * AuthManager
 * - Singleton coordinator for auth services
 * - Stores a Controller reference
 * - Lazily initializes AuthService and OcaAuthService on first access
 * - Exposes get/set methods and property accessors
 */
export class AuthManager {
	private static instance: AuthManager | null = null

	private controller: Controller
	private _authService?: AuthService
	private _ocaAuthService?: OcaAuthService

	private constructor(controller: Controller) {
		this.controller = controller
	}

	/**
	 * Initialize the singleton with a Controller.
	 * - Safe to call multiple times; updates controller on existing instance.
	 */
	public static initialize(controller: Controller): AuthManager {
		if (!AuthManager.instance) {
			AuthManager.instance = new AuthManager(controller)
		} else {
			AuthManager.instance.setController(controller)
		}
		return AuthManager.instance
	}

	/**
	 * Get the singleton instance without requiring a Controller.
	 * - Throws if not yet initialized. Call initialize(controller) first.
	 */
	public static getInstance(): AuthManager {
		if (!AuthManager.instance) {
			throw new Error("AuthManager has not been initialized. Call AuthManager.initialize(controller) first.")
		}
		return AuthManager.instance
	}

	/**
	 * Update the stored Controller and propagate to initialized services.
	 */
	public setController(controller: Controller): void {
		this.controller = controller
		if (this._authService) {
			// AuthService supports controller setter
			this._authService.controller = controller
		}
		if (this._ocaAuthService) {
			// Ensure OCA service has the latest controller
			OcaAuthService.getInstance(controller)
		}
	}

	// ----- Cline Account AuthService -----

	/**
	 * Lazy getter for AuthService.
	 * Ensures the current controller is set.
	 */
	private getAuthService(): AuthService {
		if (!this._authService) {
			this._authService = AuthService.getInstance(this.controller)
		} else {
			this._authService.controller = this.controller
		}
		return this._authService
	}

	/**
	 * Setter to inject/override the AuthService instance.
	 */
	private setAuthService(service: AuthService): void {
		this._authService = service
	}

	// Property accessors (convenience)
	public get authService(): AuthService {
		return this.getAuthService()
	}
	public set authService(service: AuthService) {
		this.setAuthService(service)
	}

	// ----- OCA AuthService -----

	/**
	 * Lazy getter for OcaAuthService.
	 * Ensures a controller is provided to the OCA singleton.
	 */
	private getOcaAuthService(): OcaAuthService {
		if (!this._ocaAuthService) {
			this._ocaAuthService = OcaAuthService.getInstance(this.controller)
		} else {
			// Refresh controller on the singleton to keep it current
			OcaAuthService.getInstance(this.controller)
		}
		return this._ocaAuthService
	}

	/**
	 * Setter to inject/override the OcaAuthService instance.
	 */
	private setOcaAuthService(service: OcaAuthService): void {
		this._ocaAuthService = service
	}

	// Property accessors (convenience)
	public get ocaAuthService(): OcaAuthService {
		return this.getOcaAuthService()
	}
	public set ocaAuthService(service: OcaAuthService) {
		this.setOcaAuthService(service)
	}
}

export default AuthManager
