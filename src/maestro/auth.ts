import axios from "axios"
import * as vscode from "vscode"
import { MaestroUser, MaestroUserSchema } from "../shared/maestro"

const MAESTRO_BASE_URL = "https://maestro.im-ada.ai"

export function didClickMaestroSignIn() {
	const loginUrl = `${MAESTRO_BASE_URL}/auth/login?ext=1&redirectTo=${vscode.env.uriScheme}://saoudrizwan.claude-dev?token=jwt`
	vscode.env.openExternal(vscode.Uri.parse(loginUrl))
}

export async function validateMaestroToken({
	token,
	showError = false,
}: {
	token: string
	showError?: boolean
}): Promise<MaestroUser> {
	try {
		const response = await axios.post(`${MAESTRO_BASE_URL}/api/extension/auth/callback`, { token })
		const user = MaestroUserSchema.parse(response.data.user)
		console.log("retrieved user", user)
		return user
	} catch (error) {
		if (showError) {
			if (axios.isAxiosError(error)) {
				vscode.window.showErrorMessage(
					"Failed to validate token:",
					error.response?.status,
					error.response?.data
				)
			} else {
				vscode.window.showErrorMessage("An unexpected error occurred:", error)
			}
		}
		throw error
	}
}
