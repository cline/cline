export function sameHubUrl(left: string, right: string): boolean {
	try {
		const leftUrl = new URL(left);
		const rightUrl = new URL(right);
		leftUrl.hash = "";
		rightUrl.hash = "";
		return leftUrl.toString() === rightUrl.toString();
	} catch {
		return left.trim() === right.trim();
	}
}

/**
 * Keep a user-supplied authToken query param when hub state publishes the same
 * endpoint without the token (custom hubs strip tokens from hubUrl).
 */
export function preserveHubUrlAuthToken(
	previous: string,
	next: string,
): string {
	if (!next) {
		return previous;
	}
	if (!previous) {
		return next;
	}
	try {
		const previousUrl = new URL(previous);
		const nextUrl = new URL(next);
		const previousToken = previousUrl.searchParams.get("authToken")?.trim();
		previousUrl.searchParams.delete("authToken");
		previousUrl.hash = "";
		nextUrl.searchParams.delete("authToken");
		nextUrl.hash = "";
		if (previousToken && previousUrl.toString() === nextUrl.toString()) {
			return previous;
		}
	} catch {
		// Fall through to the hub-published URL.
	}
	return next;
}
