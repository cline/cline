"use client";

import { useEffect, useState } from "react";
import { MockTerminalOutput } from "./mock-terminal-output";
import { TerminalPanel, type TerminalTab } from "./terminal-panel";

/**
 * Placement candidates for the integrated terminal. Dev-only: selected with
 * `?terminalMock=<variant>` so each layout can be screenshotted in the real
 * app shell before one is built out for real.
 */
export type TerminalMockVariant =
	| "dock"
	| "split"
	| "view"
	| "overlay"
	| "composer";

const VARIANTS: TerminalMockVariant[] = [
	"dock",
	"split",
	"view",
	"overlay",
	"composer",
];

export function useTerminalMockVariant(): TerminalMockVariant | null {
	const [variant, setVariant] = useState<TerminalMockVariant | null>(null);
	useEffect(() => {
		if (process.env.NODE_ENV === "production") return;
		const value = new URLSearchParams(window.location.search).get(
			"terminalMock",
		);
		setVariant(
			VARIANTS.includes(value as TerminalMockVariant)
				? (value as TerminalMockVariant)
				: null,
		);
	}, []);
	return variant;
}

const MOCK_TABS: TerminalTab[] = [
	{ id: "1", title: "zsh", busy: false },
	{ id: "2", title: "bun dev", busy: true },
];

export function TerminalMock({
	cwd,
	branch,
	compact = false,
	rows,
	anchor,
	className,
	onClose,
}: {
	cwd: string;
	branch: string | null;
	compact?: boolean;
	rows?: "short" | "full";
	anchor?: "top" | "bottom";
	className?: string;
	onClose?: () => void;
}) {
	const cwdLabel = cwd.split("/").filter(Boolean).pop() ?? "~";
	const branchLabel = branch && branch !== "no-git" ? branch : null;
	return (
		<TerminalPanel
			activeTabId="1"
			branch={branchLabel}
			className={className}
			compact={compact}
			cwdLabel={cwdLabel}
			onClose={onClose ?? (() => undefined)}
			onNewTab={() => undefined}
			onSplit={compact ? undefined : () => undefined}
			onToggleMaximize={compact ? undefined : () => undefined}
			tabs={MOCK_TABS}
		>
			<MockTerminalOutput
				anchor={anchor}
				branch={branchLabel ?? "main"}
				cwdLabel={cwdLabel}
				rows={rows}
			/>
		</TerminalPanel>
	);
}
