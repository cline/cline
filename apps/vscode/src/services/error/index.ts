import { ErrorSettings } from "./providers/IErrorProvider"

export { ErrorService } from "./ErrorService"
export type { ErrorSettings } from "./providers/IErrorProvider"
export function getErrorLevelFromString(level: string | undefined): ErrorSettings["level"] {
	switch (level) {
		case "disabled":
		case "off":
			return "off"
		case "error":
		case "crash":
			return "error"
		default:
			return "all"
	}
}
