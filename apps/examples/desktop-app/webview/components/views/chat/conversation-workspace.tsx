"use client";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { requestPromptInputFocus } from "@/lib/prompt-input-focus";
import { WorkspacePanelFrame } from "./workspace-panel-frame";

type Surface =
	| { kind: "hidden" }
	| { kind: "side" }
	| { kind: "files" | "changes"; threadId: string };
export type ConversationWorkspaceControls = {
	surface: Surface;
	target: HTMLDivElement | null;
	sideTarget: HTMLElement | null;
	mainThreadId: string;
	sideThreadId?: string;
	mainVisible: boolean;
	sideVisible: boolean;
	narrow: boolean;
	open: (surface: Exclude<Surface, { kind: "hidden" }>) => void;
	toggle: (threadId: string, kind: "files" | "changes") => void;
	close: () => void;
	showMain: () => void;
	getCloseRevision: () => number;
};
export function ConversationWorkspace({
	mainThreadId,
	sideThreadId,
	openVersion,
	main,
	side,
}: {
	mainThreadId: string;
	sideThreadId?: string;
	openVersion: number;
	main: (controls: ConversationWorkspaceControls) => ReactNode;
	side: (controls: ConversationWorkspaceControls) => ReactNode;
}) {
	const host = useRef<HTMLDivElement>(null);
	const epoch = useRef(0);
	const lastOpenVersion = useRef(openVersion);
	const lastSideThreadId = useRef(sideThreadId);
	const [sideTarget, setSideTarget] = useState<HTMLElement | null>(null);
	const [surface, setSurface] = useState<Surface>(
		sideThreadId ? { kind: "side" } : { kind: "hidden" },
	);
	const [showWorkspace, setShowWorkspace] = useState(true);
	const [narrow, setNarrow] = useState(false);
	const [target, setTarget] = useState<HTMLDivElement | null>(null);
	const getCloseRevision = useCallback(() => epoch.current, []);
	useEffect(() => {
		const element = host.current;
		if (!element) return;
		const measure = () => {
			const width = element.getBoundingClientRect().width;
			if (width > 0) setNarrow(width < 900);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const open = useCallback((next: Surface) => {
		epoch.current++;
		setSurface(next);
		setShowWorkspace(true);
	}, []);
	const close = useCallback(() => {
		epoch.current++;
		setSurface({ kind: "hidden" });
		setShowWorkspace(false);
		requestPromptInputFocus(mainThreadId);
	}, [mainThreadId]);
	const showMain = useCallback(() => {
		epoch.current++;
		setShowWorkspace(false);
		requestPromptInputFocus(mainThreadId);
	}, [mainThreadId]);
	const toggle = useCallback(
		(threadId: string, kind: "files" | "changes") => {
			epoch.current++;
			setSurface((current) =>
				current.kind === kind &&
				current.threadId === threadId &&
				(!narrow || showWorkspace)
					? { kind: "hidden" }
					: { kind, threadId },
			);
			setShowWorkspace(true);
		},
		[narrow, showWorkspace],
	);
	useEffect(() => {
		const reveal = lastOpenVersion.current !== openVersion;
		lastOpenVersion.current = openVersion;
		const removedSide = Boolean(lastSideThreadId.current) && !sideThreadId;
		lastSideThreadId.current = sideThreadId;
		if (removedSide) {
			setSurface((current) =>
				current.kind === "side" ? { kind: "hidden" } : current,
			);
			return;
		}
		if (reveal && sideThreadId) {
			setSurface({ kind: "side" });
			setShowWorkspace(true);
			requestPromptInputFocus(sideThreadId);
		}
	}, [sideThreadId, openVersion]);
	const workspaceVisible =
		surface.kind !== "hidden" && (!narrow || showWorkspace);
	const mainVisible = !narrow || !workspaceVisible;
	const sideVisible = workspaceVisible && surface.kind === "side";
	const controls = {
		surface,
		target,
		sideTarget,
		mainThreadId,
		sideThreadId,
		mainVisible,
		sideVisible,
		narrow,
		open,
		toggle,
		close,
		showMain,
		getCloseRevision,
	};
	return (
		<div ref={host} className="flex min-h-0 flex-1 overflow-hidden">
			<section
				className="flex min-h-0 min-w-0 flex-1 flex-col"
				style={{ display: mainVisible ? "flex" : "none" }}
				inert={!mainVisible || undefined}
				aria-hidden={!mainVisible || undefined}
				aria-label="Main conversation"
			>
				{main(controls)}
			</section>
			<WorkspacePanelFrame
				visible={workspaceVisible}
				narrow={narrow}
				panel={surface.kind === "side" ? "side" : "workspace"}
			>
				<section
					ref={setSideTarget}
					className="min-h-0 min-w-0 flex-1 flex-col"
					style={{ display: sideVisible ? "flex" : "none" }}
					inert={!sideVisible || undefined}
					aria-hidden={!sideVisible || undefined}
					aria-label="Side conversation"
				>
					{side(controls)}
				</section>
				<div
					ref={setTarget}
					className="min-h-0 min-w-0 flex-1"
					style={{
						display:
							surface.kind === "files" || surface.kind === "changes"
								? "flex"
								: "none",
					}}
				/>
			</WorkspacePanelFrame>
		</div>
	);
}
