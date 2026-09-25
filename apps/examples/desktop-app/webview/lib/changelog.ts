/**
 * Release notes for the About page. The source of truth is the app's
 * CHANGELOG.md; the static `/api/changelog` route bakes it into the build so
 * the notes always match the installed version and work offline.
 */

export type ChangelogRelease = {
	version: string;
	/** Markdown, one entry per top-level bullet under the version heading. */
	notes: string[];
};

export type ChangelogResponse = {
	releases: ChangelogRelease[];
};

const CHANGELOG_URL = "/api/changelog";
const REPO_URL = "https://github.com/cline/cline";

/** Desktop releases are tagged `desktop-vX.Y.Z` (see publish-desktop). */
export function releaseUrl(version: string): string {
	return `${REPO_URL}/releases/tag/desktop-v${version}`;
}

export const CHANGELOG_URL_ON_GITHUB = `${REPO_URL}/blob/main/apps/examples/desktop-app/CHANGELOG.md`;
export const ISSUES_URL = `${REPO_URL}/issues/new/choose`;

/**
 * Parses CHANGELOG.md: `## X.Y.Z` headings with `- ` bullets below. Wrapped or
 * indented continuation lines are folded into the preceding bullet.
 */
export function parseChangelog(markdown: string): ChangelogRelease[] {
	const releases: ChangelogRelease[] = [];
	let current: ChangelogRelease | null = null;
	for (const line of markdown.split(/\r?\n/)) {
		const heading = /^##\s+(\S+)\s*$/.exec(line);
		if (heading) {
			current = { version: heading[1], notes: [] };
			releases.push(current);
			continue;
		}
		if (!current) continue;
		if (/^-\s+/.test(line)) {
			current.notes.push(line.replace(/^-\s+/, "").trim());
		} else if (line.trim() && current.notes.length > 0) {
			current.notes[current.notes.length - 1] += `\n${line.trim()}`;
		}
	}
	return releases.filter((release) => release.notes.length > 0);
}

export async function fetchChangelog(): Promise<ChangelogRelease[]> {
	const response = await fetch(CHANGELOG_URL, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`Failed to load changelog: ${response.status}`);
	}
	const payload = (await response.json()) as Partial<ChangelogResponse>;
	return Array.isArray(payload.releases) ? payload.releases : [];
}
