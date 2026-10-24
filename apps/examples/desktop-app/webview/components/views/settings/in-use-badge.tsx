"use client";

import { useState } from "react";
import { type ProviderSection, readProviderSectionInUse } from "./sections";

/** Marks the Providers sub-page whose provider the chat currently uses. */
export function InUseBadge({ section }: { section: ProviderSection }) {
	const [inUse] = useState(() => readProviderSectionInUse() === section);
	if (!inUse) return null;
	return (
		<span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
			<span className="size-1.5 rounded-full bg-emerald-500" />
			In use
		</span>
	);
}
