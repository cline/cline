import { AuthService } from "../../../services/auth/AuthService"

const authService = AuthService.getInstance({})
export const subscribeToAuthCallback = authService.subscribeToAuthCallback.bind(authService)
export const sendAuthCallbackEvent = authService.sendAuthCallbackEvent.bind(authService)
