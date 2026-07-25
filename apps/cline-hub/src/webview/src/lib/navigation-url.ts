interface BrowserLocationParts {
	pathname: string;
	search: string;
	hash: string;
}

export function locationPath(location: BrowserLocationParts): string {
	return `${location.pathname}${location.search}${location.hash}`;
}

export function pathWithLocationHash(
	path: string,
	location: Pick<BrowserLocationParts, "hash">,
): string {
	return `${path}${location.hash}`;
}
