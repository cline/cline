import * as vscode from "vscode"
import { IClineProvider } from "../../core/webview/IClineProvider"

export interface UserInfo {
	displayName: string | null
	email: string | null
	photoURL: string | null
}

export class FirebaseAuthManager {
	constructor(private provider: IClineProvider) {}

	dispose() {
		// Implementation
	}

	async signOut() {
		await this.provider.setAuthToken(undefined)
		await this.provider.setUserInfo(undefined)
	}

	async signInWithCustomToken(token: string) {
		await this.provider.setAuthToken(token)
		// Implementation for getting user info would go here
		await this.provider.setUserInfo({
			displayName: null,
			email: null,
			photoURL: null,
		})
	}
}
