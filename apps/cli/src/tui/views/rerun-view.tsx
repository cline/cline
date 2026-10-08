import "opentui-spinner/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../hooks/use-theme";

export type RerunRunner<T> = (handlers: {
	onLine: (line: string) => void;
	signal: AbortSignal;
}) => Promise<T>;

function reportLineColor(line: string, accent: string): string | undefined {
	if (line.startsWith("Result: diverged")) return "red";
	if (line.startsWith("Result: no divergence")) return "green";
	if (line === "First divergence" || line === "Not reproduced") return "yellow";
	if (line === "Session rerun") return accent;
	return undefined;
}

export function RerunView<T>(props: {
	title: string;
	run: RerunRunner<T>;
	reportLines: (outcome: T) => string[];
	onSettled: (value: { outcome: T } | { error: unknown }) => void;
	onExit: () => void;
}) {
	const theme = useTheme();
	const scrollboxRef = useRef<ScrollBoxRenderable | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const [progress, setProgress] = useState<string[]>([]);
	const [report, setReport] = useState<string[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [aborting, setAborting] = useState(false);
	const { run, reportLines, onSettled } = props;
	const running = report === null && error === null;

	useEffect(() => {
		const controller = new AbortController();
		abortRef.current = controller;
		run({
			onLine: (line) => setProgress((lines) => [...lines, line]),
			signal: controller.signal,
		}).then(
			(outcome) => {
				onSettled({ outcome });
				setReport(reportLines(outcome));
			},
			(failure: unknown) => {
				onSettled({ error: failure });
				setError(failure instanceof Error ? failure.message : String(failure));
			},
		);
		return () => controller.abort();
	}, [run, reportLines, onSettled]);

	useEffect(() => {
		const scrollbox = scrollboxRef.current;
		if (!scrollbox || (progress.length === 0 && report === null)) return;
		const timer = setTimeout(
			() => scrollbox.scrollTo(report ? 0 : scrollbox.scrollHeight),
			0,
		);
		return () => clearTimeout(timer);
	}, [progress, report]);

	useKeyboard((key) => {
		const scrollbox = scrollboxRef.current;
		if (
			key.name === "q" ||
			key.name === "escape" ||
			(key.ctrl && key.name === "c")
		) {
			if (running) {
				setAborting(true);
				abortRef.current?.abort();
				return;
			}
			props.onExit();
			return;
		}
		if (!scrollbox) return;
		if (key.name === "pageup") scrollbox.scrollBy(-scrollbox.height / 2);
		else if (key.name === "pagedown") scrollbox.scrollBy(scrollbox.height / 2);
		else if (key.name === "up") scrollbox.scrollBy(-1);
		else if (key.name === "down") scrollbox.scrollBy(1);
		else if (key.name === "home") scrollbox.scrollTo(0);
		else if (key.name === "end") scrollbox.scrollTo(scrollbox.scrollHeight);
	});

	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="row" paddingX={1} gap={1} flexShrink={0}>
				{running && <spinner name="dots" color={theme.accents.act} />}
				<text fg={theme.accents.act}>{props.title}</text>
			</box>
			<scrollbox ref={scrollboxRef} flexGrow={1}>
				<box flexDirection="column" paddingX={1} paddingY={1}>
					{report === null &&
						progress.map((line, index) => (
							<text key={`progress:${index}:${line}`} fg="gray">
								{line}
							</text>
						))}
					{report?.map((line, index) => (
						<text
							key={`report:${index}:${line}`}
							fg={reportLineColor(line, theme.accents.act)}
						>
							{line || " "}
						</text>
					))}
					{error !== null && <text fg="red">{error}</text>}
				</box>
			</scrollbox>
			<box flexDirection="row" paddingX={1} gap={2} flexShrink={0}>
				<text fg={theme.accents.act}>
					{running
						? aborting
							? "aborting..."
							: "running"
						: error !== null
							? "failed"
							: "finished"}
				</text>
				<text fg="gray">
					{running
						? "q abort · ↑↓ PgUp/PgDn scroll"
						: "↑↓ PgUp/PgDn scroll · q quit"}
				</text>
			</box>
		</box>
	);
}
