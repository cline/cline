import { readFileSync } from "node:fs";
import { getFileIndex } from "@clinebot/core";

type WorkspaceFileSearchRequest = {
	workspaceRoot?: string;
	query?: string;
	limit?: number;
};

function readStdin(): string {
	return readFileSync(0, "utf8");
}

function normalizeLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || Number.isNaN(limit)) {
		return 10;
	}
	return Math.min(50, Math.max(1, Math.trunc(limit)));
}

function rankPath(path: string, query: string): number {
	if (query.length === 0) {
		return 3;
	}
	const lowerPath = path.toLowerCase();
	if (lowerPath.startsWith(query)) {
		return 0;
	}
	if (lowerPath.includes(`/${query}`)) {
		return 1;
	}
	if (lowerPath.includes(query)) {
		return 2;
	}
	return Number.POSITIVE_INFINITY;
}

async function main() {
	const parsed = JSON.parse(readStdin()) as WorkspaceFileSearchRequest;
	const workspaceRoot = parsed.workspaceRoot?.trim() || process.cwd();
	const query = (parsed.query ?? "").trim().toLowerCase();
	const limit = normalizeLimit(parsed.limit);

	const index = await getFileIndex(workspaceRoot);
	const allPaths = Array.from(index).sort((a, b) => a.localeCompare(b));

	const results = allPaths
		.map((path) => ({ path, rank: rankPath(path, query) }))
		.filter((item) => Number.isFinite(item.rank))
		.sort((left, right) => {
			if (left.rank !== right.rank) {
				return left.rank - right.rank;
			}
			return left.path.localeCompare(right.path);
		})
		.slice(0, limit)
		.map((item) => item.path);

	process.stdout.write(`${JSON.stringify(results)}\n`);
	process.exit(0);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
