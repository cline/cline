import type {
	CloudBranchListOptions,
	CloudBranchListResult,
} from "@cline/core/cloud";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useEffect, useRef, useState } from "react";

/** Fetch one page at a time; searching does not enumerate the repository. */
export function CloudBranchContent(
	props: ChoiceContext<string> & {
		initial: CloudBranchListResult;
		selectedBranch: string;
		load: (options?: CloudBranchListOptions) => Promise<CloudBranchListResult>;
	},
) {
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(props.initial);
	const [selected, setSelected] = useState(
		Math.max(0, props.initial.branches.indexOf(props.selectedBranch)),
	);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const [retry, setRetry] = useState(0);
	const generation = useRef(0);
	const loadRef = useRef(props.load);
	loadRef.current = props.load;
	const firstPage = useRef(props.initial);
	useEffect(() => {
		const request = ++generation.current;
		setError(undefined);
		if (!query.trim() && retry === 0) {
			setPage(firstPage.current);
			setLoading(false);
			return () => {
				++generation.current;
			};
		}
		setLoading(true);
		setPage({ available: true, branches: [] });
		const timer = setTimeout(() => {
			void loadRef
				.current({ query: query.trim() || undefined })
				.then((result) => {
					if (generation.current !== request) return;
					if (!result.available)
						throw new Error("Branches unavailable. Ctrl+R to retry.");
					setPage(result);
					setSelected(0);
				})
				.catch((failure) => {
					if (generation.current === request) setError(String(failure));
				})
				.finally(() => {
					if (generation.current === request) setLoading(false);
				});
		}, 200);
		return () => {
			clearTimeout(timer);
			++generation.current;
		};
	}, [query, retry]);
	const loadMore = () => {
		if (loading || !page.nextToken) return;
		const cursor = page.nextToken;
		const request = ++generation.current;
		setLoading(true);
		setError(undefined);
		void loadRef
			.current({ query: query.trim() || undefined, cursor })
			.then((result) => {
				if (generation.current !== request) return;
				if (!result.available)
					throw new Error("Branches unavailable. Ctrl+R to retry.");
				setPage((previous) => ({
					available: true,
					branches: [...new Set([...previous.branches, ...result.branches])],
					nextToken: result.nextToken === cursor ? undefined : result.nextToken,
				}));
			})
			.catch((failure) => {
				if (generation.current === request) setError(String(failure));
			})
			.finally(() => {
				if (generation.current === request) setLoading(false);
			});
	};
	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			key.preventDefault();
			props.dismiss();
			return;
		}
		if (key.ctrl && key.name === "r") {
			key.preventDefault();
			setRetry((value) => value + 1);
			return;
		}
		if (loading) return;
		if (key.name === "up") {
			key.preventDefault();
			setSelected((value) => Math.max(0, value - 1));
		}
		if (key.name === "down") {
			key.preventDefault();
			if (selected === page.branches.length - 1 && page.nextToken) loadMore();
			else
				setSelected((value) => Math.min(page.branches.length - 1, value + 1));
		}
		if (key.name === "return" || key.name === "enter") {
			key.preventDefault();
			if (page.branches[selected]) props.resolve(page.branches[selected]);
		}
	}, props.dialogId);
	const start = Math.max(0, selected - 5);
	return (
		<box flexDirection="column" padding={1} gap={1}>
			<text>Starting branch</text>
			<input
				focused
				value={query}
				placeholder="Search branches…"
				onInput={(value) => {
					if (value === query) return;
					++generation.current;
					setQuery(value);
					setSelected(0);
					setLoading(true);
				}}
			/>
			{!loading &&
				page.branches.slice(start, start + 12).map((branch, offset) => (
					<text
						key={branch}
						fg={start + offset === selected ? "cyan" : undefined}
					>
						{start + offset === selected ? "> " : "  "}
						{branch}
					</text>
				))}
			{loading && <text fg="gray">Loading branches…</text>}
			{!loading && !page.branches.length && <text>No matching branches.</text>}
			{error && <text fg="yellow">{error}</text>}
			<text fg="gray">
				Type to search · ↑↓ choose{page.nextToken ? " / load more" : ""} · Enter
				select · Esc cancel
			</text>
		</box>
	);
}
