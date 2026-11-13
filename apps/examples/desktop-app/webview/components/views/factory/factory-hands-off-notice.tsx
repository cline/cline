"use client";

import { isFactoryHandsOff } from "@cline/shared/browser";
import { Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useFactoryPresets } from "@/hooks/use-factory-presets";
import { FACTORY_SETTING_LABEL, FACTORY_TERMS } from "@/lib/factory-copy";
import type { FactoryPreset } from "@/lib/factory-presets";
import { cn } from "@/lib/utils";
import { toneSurface, toneText } from "./factory-ui";

export const HANDS_OFF_NOTICE_DISMISSED_KEY = "factory.handsOffNoticeDismissed";
export const HANDS_OFF_NOTICE_TEXT = `Factory now runs work to a draft PR on its own. To review plans first, turn on “${FACTORY_SETTING_LABEL.pauseForApproval}” in ${FACTORY_TERMS.settings}.`;

/**
 * Whether new work runs hands-off: the chosen default is hands-off, or it is
 * missing or invalid and the built-in Hands-off workflow stands in for it.
 */
export function defaultRunsHandsOff(
	presets: FactoryPreset[],
	defaultPreset: string | undefined,
): boolean {
	if (!defaultPreset) return false;
	const current = presets.find((preset) => preset.name === defaultPreset);
	return current ? isFactoryHandsOff(current.config) : true;
}

/**
 * One-time notice that Factory now runs new work to a draft PR on its own.
 * The sidecar upgrades a legacy default without a click; this only explains
 * it, and is hidden once dismissed or when the default no longer runs
 * hands-off.
 */
export function FactoryHandsOffNotice({ className }: { className?: string }) {
	const { presets, defaultPreset, loading, error } = useFactoryPresets();
	const [dismissed, setDismissed] = useState(
		() =>
			typeof window !== "undefined" &&
			window.localStorage?.getItem(HANDS_OFF_NOTICE_DISMISSED_KEY) === "true",
	);
	if (
		dismissed ||
		loading ||
		error ||
		!defaultRunsHandsOff(presets, defaultPreset)
	)
		return null;
	return (
		<section
			aria-label="Factory runs work automatically"
			className={cn(
				"flex items-center gap-3 rounded-lg border px-4 py-3 text-sm",
				toneSurface("accent"),
				className,
			)}
		>
			<Sparkles className={cn("size-4 shrink-0", toneText("accent"))} />
			<p title={HANDS_OFF_NOTICE_TEXT} className="line-clamp-2 min-w-0 flex-1">
				{HANDS_OFF_NOTICE_TEXT}
			</p>
			<Button
				size="sm"
				variant="ghost"
				aria-label="Dismiss notice"
				onClick={() => {
					window.localStorage?.setItem(HANDS_OFF_NOTICE_DISMISSED_KEY, "true");
					setDismissed(true);
				}}
			>
				<X className="size-3.5" />
			</Button>
		</section>
	);
}
