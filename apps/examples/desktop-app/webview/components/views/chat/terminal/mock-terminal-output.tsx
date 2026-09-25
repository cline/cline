"use client";

import { cn } from "@/lib/utils";

/**
 * Static stand-in for the xterm surface, used only to evaluate terminal
 * placements. Mirrors the colors a real shell would render so the mockups read
 * as a terminal rather than a code block.
 */
export function MockTerminalOutput({
	cwdLabel,
	branch,
	rows,
	anchor = "top",
	className,
}: {
	cwdLabel: string;
	branch: string;
	/** Trim the transcript to fit shorter placements. */
	rows?: "short" | "full";
	/** Pin the prompt to the bottom, as a scrolled shell would look in a short pane. */
	anchor?: "top" | "bottom";
	className?: string;
}) {
	const prompt = (
		<div className="mt-2 flex gap-2">
			<span className="text-info-text">{cwdLabel}</span>
			<span className="text-muted-foreground">on</span>
			<span className="text-brand-violet"> {branch}</span>
		</div>
	);
	return (
		<div
			className={cn(
				"flex h-full w-full flex-col overflow-hidden px-3 py-2 font-mono text-[12px] leading-[1.5] text-foreground/90 select-text",
				anchor === "bottom" && "justify-end",
				className,
			)}
		>
			{rows !== "short" ? (
				<>
					{prompt}
					<div>
						<span className="text-primary">❯</span> bun run test:desktop-client
					</div>
					<div className="text-muted-foreground">$ bun run build:ui</div>
					<div className="text-muted-foreground">
						$ vitest run webview/lib/desktop-client.test.ts --config
						vitest.config.ts
					</div>
					<div className="mt-2">
						<span className="rounded-sm bg-brand-cyan px-1 text-background">
							RUN
						</span>{" "}
						<span className="text-muted-foreground">v4.0.18</span>{" "}
						/workspace/apps/examples/desktop-app
					</div>
					<div className="mt-2">
						<span className="text-success-text">✓</span>{" "}
						webview/lib/desktop-client.test.ts{" "}
						<span className="text-muted-foreground">(21 tests) 412ms</span>
					</div>
					<div className="mt-2">
						<span className="text-muted-foreground"> Test Files </span>
						<span className="text-success-text">1 passed</span>{" "}
						<span className="text-muted-foreground">(1)</span>
					</div>
					<div>
						<span className="text-muted-foreground"> Tests </span>
						<span className="text-success-text">21 passed</span>{" "}
						<span className="text-muted-foreground">(21)</span>
					</div>
					<div>
						<span className="text-muted-foreground"> Duration </span>
						1.53s
					</div>
				</>
			) : null}
			{prompt}
			<div>
				<span className="text-primary">❯</span> git status --short
			</div>
			<div>
				<span className="text-warning-text"> M</span>{" "}
				apps/examples/desktop-app/webview/app/page.tsx
			</div>
			<div>
				<span className="text-error-text">??</span>{" "}
				apps/examples/desktop-app/webview/components/views/chat/terminal/
			</div>
			{prompt}
			<div>
				<span className="text-primary">❯</span>{" "}
				<span className="-mb-0.5 inline-block h-[14px] w-[7px] animate-pulse bg-foreground/80 align-text-bottom" />
			</div>
		</div>
	);
}
