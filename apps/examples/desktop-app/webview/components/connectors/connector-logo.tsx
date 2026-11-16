"use client";

import { GitHubIcon } from "@cline/ui";
import { CalendarDays, Mail } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useHubTheme } from "@/hooks/use-hub-theme";
import { composioLogoUrl } from "@/lib/composio-recipes";
import { cn } from "@/lib/utils";

const FALLBACK_ICONS: Record<
	string,
	(props: { className?: string }) => ReactNode
> = {
	gmail: (props) => <Mail aria-hidden="true" {...props} />,
	googlecalendar: (props) => <CalendarDays aria-hidden="true" {...props} />,
	github: (props) => <GitHubIcon {...props} />,
};

/** The connector's brand mark, filling `className` (size and radius) edge to
 * edge so it doubles as the tile wherever one is needed. */
export function ConnectorLogo({
	slug,
	name,
	logo,
	className,
}: {
	slug: string;
	name: string;
	logo?: string;
	className?: string;
}) {
	const theme = useHubTheme();
	const [failedSources, setFailedSources] = useState<string[]>([]);
	// Keep catalog-only logos: unknown CDN slugs return a successful placeholder.
	const src = [
		composioLogoUrl(slug, theme, logo),
		composioLogoUrl(slug, theme),
	].find((candidate) => !failedSources.includes(candidate));
	if (src) {
		return (
			// biome-ignore lint/performance/noImgElement: Composio logos live on arbitrary remote hosts Next's optimizer is not configured for.
			<img
				alt=""
				className={cn(
					"size-8 shrink-0 rounded-sm object-contain",
					slug === "freshbooks" && "dark:bg-white dark:p-0.5",
					className,
				)}
				key={src}
				onError={() => setFailedSources((previous) => [...previous, src])}
				src={src}
			/>
		);
	}
	// Themed fallbacks for the recommended toolkits when the logo host is
	// unreachable.
	const LocalIcon = FALLBACK_ICONS[slug];
	return (
		<span
			className={cn(
				"flex size-5 shrink-0 items-center justify-center rounded-sm bg-secondary text-foreground",
				className,
			)}
		>
			{LocalIcon ? (
				<LocalIcon className="size-[60%]" />
			) : (
				<span className="font-semibold text-muted-foreground text-xs uppercase leading-none">
					{name.slice(0, 1)}
				</span>
			)}
		</span>
	);
}
