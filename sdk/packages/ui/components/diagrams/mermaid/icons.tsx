"use client";

import type { ReactNode } from "react";

/** Inline SVG icon set for the Mermaid block toolbar and viewport chrome. */

export function Icon({ children }: { children: ReactNode }) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
			width="14"
			xmlns="http://www.w3.org/2000/svg"
		>
			{children}
		</svg>
	);
}

export const ICONS = {
	check: <path d="M20 6 9 17l-5-5" />,
	copy: (
		<>
			<rect height="13" rx="2" width="13" x="9" y="9" />
			<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
		</>
	),
	download: (
		<>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<path d="m7 10 5 5 5-5" />
			<path d="M12 15V3" />
		</>
	),
	enter: (
		<>
			<path d="M15 3h6v6" />
			<path d="M9 21H3v-6" />
			<path d="m21 3-7 7" />
			<path d="m3 21 7-7" />
		</>
	),
	exit: (
		<>
			<path d="m14 10 7-7" />
			<path d="M20 10h-6V4" />
			<path d="m3 21 7-7" />
			<path d="M4 14h6v6" />
		</>
	),
	reset: (
		<>
			<path d="M3 12a9 9 0 1 0 3-6.7" />
			<path d="M3 4v5h5" />
		</>
	),
	zoomIn: (
		<>
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
			<path d="M11 8v6" />
			<path d="M8 11h6" />
		</>
	),
	zoomOut: (
		<>
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
			<path d="M8 11h6" />
		</>
	),
} satisfies Record<string, ReactNode>;
