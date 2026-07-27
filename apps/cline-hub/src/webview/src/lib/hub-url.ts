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
