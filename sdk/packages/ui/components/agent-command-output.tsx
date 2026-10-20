"use client";

import { type ReactNode, useEffect, useRef } from "react";

export interface AgentCommandOutputProps {
	output: string;
	isRunning: boolean;
	/** Hosts retain ANSI rendering or control-character normalization. */
	children?: ReactNode;
	tabIndex?: number;
	classNames?: { viewport?: string; cursor?: string };
}

export function AgentCommandOutput({
	output,
	isRunning,
	children = output,
	tabIndex,
	classNames,
}: AgentCommandOutputProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const shouldAutoScrollRef = useRef(true);
	useEffect(() => {
		const container = containerRef.current;
		if (container && shouldAutoScrollRef.current) {
			container.scrollTop = output ? container.scrollHeight : 0;
		}
	}, [output]);

	return (
		<div className="mt-2 space-y-1">
			<div className="text-[11px] uppercase tracking-wide text-cline-ui-muted-foreground/80">
				Output
			</div>
			<div
				aria-label="Command output"
				aria-live="off"
				className={`max-h-64 overflow-auto rounded-md border border-cline-ui-border/70 bg-black/90 p-3 font-cline-ui-mono text-cline-ui-xs leading-relaxed text-zinc-100${classNames?.viewport ? ` ${classNames.viewport}` : ""}`}
				onScroll={(event) => {
					const container = event.currentTarget;
					shouldAutoScrollRef.current =
						container.scrollHeight -
							container.scrollTop -
							container.clientHeight <
						24;
				}}
				ref={containerRef}
				role="log"
				tabIndex={tabIndex}
			>
				<pre className="whitespace-pre-wrap break-words">
					{children}
					{isRunning ? (
						<span
							aria-hidden="true"
							className={`ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-zinc-100${classNames?.cursor ? ` ${classNames.cursor}` : ""}`}
						/>
					) : null}
				</pre>
			</div>
		</div>
	);
}
