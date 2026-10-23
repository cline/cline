/** A review link needs no GitHub token or additional mobile API permissions. */
export function repositoryReviewUrl(
	repoUrl?: string,
	branch?: string,
): string | undefined {
	if (!repoUrl) return undefined;
	try {
		const url = new URL(repoUrl);
		if (
			url.protocol !== "https:" ||
			url.hostname !== "github.com" ||
			url.username ||
			url.password ||
			url.port
		)
			return undefined;
		const parts = url.pathname
			.replace(/\.git\/?$/, "")
			.split("/")
			.filter(Boolean);
		if (parts.length !== 2 || parts.some((part) => !/^[\w.-]+$/.test(part)))
			return undefined;
		const repository = `https://github.com/${parts.join("/")}`;
		return branch
			? `${repository}/compare/${encodeURIComponent(branch)}?expand=1`
			: `${repository}/pulls`;
	} catch {
		return undefined;
	}
}
