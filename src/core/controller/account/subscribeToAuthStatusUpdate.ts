import { AuthService } from "../../../services/auth/AuthService"

const authService = AuthService.getInstance()
export const subscribeToAuthStatusUpdate = authService.subscribeToAuthStatusUpdate.bind(authService)
export const sendAuthStatusUpdateEvent = authService.sendAuthStatusUpdate.bind(authService)
