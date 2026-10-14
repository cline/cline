import { readFile } from "node:fs/promises";
import { parseChangelog } from "@/lib/changelog";

// Baked into the static export at build time, like the marketplace catalog
// route, so the shipped app reads release notes for exactly its own version.
export const dynamic = "force-static";

export async function GET() {
	try {
		const markdown = await readFile(
			process.env.CLINE_DESKTOP_CHANGELOG_PATH ?? "",
			"utf8",
		);
		return Response.json({ releases: parseChangelog(markdown) });
	} catch (error) {
		return Response.json({
			releases: [],
			error:
				error instanceof Error ? error.message : "Failed to read changelog",
		});
	}
}
