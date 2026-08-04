import { useCallback, useEffect, useRef, useState } from "react";
import { watchGitHead } from "../../utils/git-head-watcher";
import {
	isSameRepoStatus,
	type RepoStatus,
	readRepoStatus,
} from "../../utils/repo-status";

/**
 * Tracks the git branch / diff stats shown in the status bar. Beyond the
 * explicit refreshes triggered after agent turns, it watches the repo's HEAD
 * file so branch switches made outside the CLI (another terminal, an editor)
 * show up promptly; git only runs when HEAD actually changed.
 */
export function useRepoStatus(options: {
	cwd: string;
	initialStatus?: RepoStatus;
}): {
	repoStatus: RepoStatus;
	refreshRepoStatus: () => void;
} {
	const { cwd, initialStatus } = options;
	const [repoStatus, setRepoStatus] = useState<RepoStatus>(
		initialStatus ?? { branch: null, diffStats: null },
	);
	const inFlightRef = useRef(false);
	const pendingRef = useRef(false);

	const refreshRepoStatus = useCallback(
		function refresh() {
			if (inFlightRef.current) {
				pendingRef.current = true;
				return;
			}
			inFlightRef.current = true;
			readRepoStatus(cwd)
				.then((next) => {
					// Keep the previous object when nothing changed so
					// consumers don't re-render every poll tick.
					setRepoStatus((prev) => (isSameRepoStatus(prev, next) ? prev : next));
				})
				.catch(() => {})
				.finally(() => {
					inFlightRef.current = false;
					if (pendingRef.current) {
						pendingRef.current = false;
						refresh();
					}
				});
		},
		[cwd],
	);

	useEffect(() => {
		return watchGitHead(cwd, refreshRepoStatus);
	}, [cwd, refreshRepoStatus]);

	return { repoStatus, refreshRepoStatus };
}
