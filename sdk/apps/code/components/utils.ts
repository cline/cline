import { formatDisplayUserInput } from "@clinebot/shared";

export function normalizeTitle(title?: string): string {
	if (!title?.trim()) return "";
	return formatDisplayUserInput(title);
}
