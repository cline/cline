import { Badge, Button, SectionHeading } from "@cline/ui";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";

import { openExternalUrl } from "@/lib/desktop-client";
import type { MarketplaceEntry } from "@/lib/marketplace";
import { CustomizationDescription } from "../shared/customization-description";
import { CustomizationItemDetails } from "../shared/customization-item-details";
import { CustomizationTypeBadge } from "../shared/customization-type-badge";
import {
	EnvironmentRequirements,
	InstallationNotes,
} from "../shared/environment-setup";
import { MarketplaceSkillPreview } from "./marketplace-skill-preview";

export function MarketplaceEntryDetails({
	entry,
	installed = false,
	actions,
	leadingActions,
	feedback,
	tagLabels,
	skillContent,
	metadata,
	onSelectTag,
	onCategorySelected,
}: {
	entry: MarketplaceEntry;
	installed?: boolean;
	actions: ReactNode;
	leadingActions?: ReactNode;
	feedback?: ReactNode;
	tagLabels?: Map<string, string>;
	skillContent?: ReactNode;
	metadata?: ReactNode;
	onSelectTag?: (tag: string) => void;
	onCategorySelected?: () => void;
}) {
	const learnMoreUrl = entry.homepage ?? entry.repo;
	const authorUrl = entry.author?.url;
	const requirements = entry.install.env ?? [];
	const separateLearnMore = entry.type === "mcp" && installed;
	const learnMoreButton = learnMoreUrl ? (
		<Button
			onClick={() => void openExternalUrl(learnMoreUrl)}
			size="sm"
			tone="neutral"
			type="button"
			variant="secondary"
			trailingIcon={ArrowUpRight}
			iconTone="muted"
		>
			Learn more
		</Button>
	) : null;
	return (
		<CustomizationItemDetails
			title={entry.name}
			header={(titleRef) => (
				<>
					<CustomizationTypeBadge
						className="self-start"
						onSelected={onCategorySelected}
						type={entry.type}
					/>
					<div className="flex min-w-0 flex-col gap-2">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<h2
								ref={titleRef}
								className="wrap-break-word min-w-0 font-semibold text-2xl text-foreground"
							>
								{entry.name}
							</h2>
							{entry.verified ? (
								<Badge className="gap-1" tone="info">
									<BadgeCheck className="size-3" />
									Verified
								</Badge>
							) : null}
						</div>
						{entry.tagline ? (
							<CustomizationDescription className="text-muted-foreground text-sm">
								{entry.tagline}
							</CustomizationDescription>
						) : null}
						{entry.author ? (
							<p className="mt-5 text-muted-foreground text-sm">
								By{" "}
								{authorUrl ? (
									<a
										className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										href={authorUrl}
										onClick={(event) => {
											event.preventDefault();
											void openExternalUrl(authorUrl);
										}}
									>
										{entry.author.name}
									</a>
								) : (
									entry.author.name
								)}
							</p>
						) : null}
					</div>
					{separateLearnMore && leadingActions && learnMoreButton ? (
						<div className="flex">{learnMoreButton}</div>
					) : null}
				</>
			)}
			actions={
				<>
					{!separateLearnMore ? learnMoreButton : null}
					{actions}
				</>
			}
			leadingActions={
				leadingActions ?? (separateLearnMore ? learnMoreButton : null)
			}
			feedback={feedback}
			categories={entry.tags}
			tagLabels={tagLabels}
			onSelectCategory={onSelectTag}
			onCategorySelected={onCategorySelected}
		>
			{entry.description ? (
				<CustomizationDescription className="text-muted-foreground text-sm leading-6">
					{entry.description}
				</CustomizationDescription>
			) : null}

			{metadata}

			{entry.type === "skill"
				? (skillContent ?? (
						<MarketplaceSkillPreview
							entry={entry}
							key={`${entry.type}:${entry.id}`}
						/>
					))
				: null}

			{requirements.length > 0 ? (
				<section className="grid gap-4">
					<SectionHeading size="base" title="Environment setup" />
					<EnvironmentRequirements requirements={requirements} />
				</section>
			) : null}
			<InstallationNotes notes={entry.install.notes} />
		</CustomizationItemDetails>
	);
}
