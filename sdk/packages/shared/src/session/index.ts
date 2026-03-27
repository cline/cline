import { nanoid } from "nanoid";

export function createSessionId(prefix = "", suffix = ""): string {
	return `${prefix}${Date.now()}_${nanoid(5)}${suffix}`;
}
