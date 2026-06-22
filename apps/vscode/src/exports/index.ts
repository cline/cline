import { Controller } from "@core/controller"
import { ClineAPI } from "./cline"

// Minimal inert implementation. The real agent/task wiring has been removed,
// so every method is a no-op that resolves immediately.
export function createClineAPI(_sidebarController: Controller): ClineAPI {
	const api: ClineAPI = {
		startNewTask: async (_task?: string, _images?: string[]) => {},
		sendMessage: async (_message?: string, _images?: string[]) => {},
		pressPrimaryButton: async () => {},
		pressSecondaryButton: async () => {},
	}

	return api
}
