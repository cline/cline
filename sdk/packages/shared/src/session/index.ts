import { customAlphabet } from "nanoid";

export function createSessionId(prefix = "", suffix = ""): string {
	const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 10);
	return `${prefix}${Date.now()}_${nanoid(5)}${suffix}`;
}
