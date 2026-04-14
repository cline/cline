import { getFileIndex } from "@clinebot/core";
import type { SidecarContext } from "../types";

export function searchWorkspaceFiles(
	ctx: Pick<SidecarContext, "workspaceRoot">,
	args?: Record<string, unknown>,
): Promise<string[]> {
	const root =
		typeof args?.workspaceRoot === "string" && args.workspaceRoot.trim()
			? args.workspaceRoot.trim()
			: ctx.workspaceRoot;
	const query =
		typeof args?.query === "string" ? args.query.trim().toLowerCase() : "";
	const limit =
		typeof args?.limit === "number" && Number.isFinite(args.limit)
			? Math.max(1, Math.min(50, Math.trunc(args.limit)))
			: 10;
	const rankPath = (path: string) => {
		if (!query) {
			return 3;
		}
		const lower = path.toLowerCase();
		if (lower.startsWith(query)) {
			return 0;
		}
		if (lower.includes(`/${query}`)) {
			return 1;
		}
		if (lower.includes(query)) {
			return 2;
		}
		return Number.POSITIVE_INFINITY;
	};
	return getFileIndex(root).then((index) =>
		Array.from(index)
			.sort((a, b) => a.localeCompare(b))
			.map((path) => ({ path, rank: rankPath(path) }))
			.filter((item) => Number.isFinite(item.rank))
			.sort((left, right) =>
				left.rank !== right.rank
					? left.rank - right.rank
					: left.path.localeCompare(right.path),
			)
			.slice(0, limit)
			.map((item) => item.path),
	);
}
