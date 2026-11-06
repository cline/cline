import type { SuggestionsLocal } from "@cline/shared/browser";

export function msSinceExposed(local: SuggestionsLocal): {
	msSinceExposed?: number;
} {
	return local.readyAt === undefined
		? {}
		: { msSinceExposed: Math.max(0, Math.round(Date.now() - local.readyAt)) };
}

export function delay(ms: number): Promise<undefined> {
	return new Promise((resolve) => setTimeout(() => resolve(undefined), ms));
}
