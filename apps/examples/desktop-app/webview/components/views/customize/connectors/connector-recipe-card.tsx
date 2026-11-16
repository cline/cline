"use client";

import { Button, IconButton, ItemCard } from "@cline/ui";
import { Check, Plus } from "lucide-react";

import { ConnectorLogo } from "@/components/connectors/connector-logo";
import { ButtonGroup } from "@/components/ui/button-group";
import type { ComposioRecipe } from "@/lib/composio-recipes";
import type {
	ComposioIntegrationSummary,
	ComposioToolkitSlug,
} from "@/lib/composio-types";
import { usePrimaryButtonRefs } from "../shared/use-primary-button-refs";

/** Suggested connectors open details by name and connect with the plus action. */
export function RecipeCard({
	recipe,
	statusBySlug,
	busyToolkit,
	onConnect,
	onCancel,
	onOpenDetails,
}: {
	recipe: ComposioRecipe;
	statusBySlug: Map<string, ComposioIntegrationSummary>;
	busyToolkit: ComposioToolkitSlug | null;
	onConnect: (slug: ComposioToolkitSlug, trigger: HTMLButtonElement) => void;
	onCancel: (slug: ComposioToolkitSlug) => void;
	onOpenDetails: (slug: ComposioToolkitSlug) => void;
}) {
	const primaryButtons = usePrimaryButtonRefs();
	return (
		<ItemCard
			title={
				// biome-ignore lint/a11y/useSemanticElements: ItemCard wraps titles in a span, so retain heading semantics with valid phrasing content.
				<span role="heading" aria-level={4}>
					{recipe.title}
				</span>
			}
			description={recipe.description}
		>
			<div className="grid gap-3">
				<p className="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground text-xs leading-5">
					&ldquo;{recipe.prompt}&rdquo;
				</p>
				<div className="flex flex-wrap gap-2">
					{recipe.connectors.map((connector) => {
						const summary = statusBySlug.get(connector.slug);
						const status = summary?.status ?? "not_connected";
						const busy = busyToolkit === connector.slug;
						const logo = (
							<ConnectorLogo
								// The icon size of the xs button it sits in.
								className="size-3"
								logo={summary?.logo}
								name={connector.name}
								slug={connector.slug}
							/>
						);
						return (
							<ButtonGroup
								className="rounded-md shadow-[0_0_0_1px_var(--neutral-a5)] [&>button]:shadow-none"
								key={connector.slug}
							>
								<Button
									ref={primaryButtons.ref(connector.slug)}
									aria-haspopup="dialog"
									aria-label={`Open ${connector.name} details`}
									onClick={() => onOpenDetails(connector.slug)}
									size="xs"
									tone="neutral"
									type="button"
									variant="secondary"
								>
									{logo}
									{connector.name}
									{status === "connected" ? (
										<Check
											aria-hidden="true"
											className="size-3.5 text-primary"
										/>
									) : null}
								</Button>
								{status !== "connected" ? (
									<IconButton
										className="relative before:absolute before:inset-y-1.5 before:left-0 before:w-px before:bg-(--neutral-a5) before:content-['']"
										aria-label={
											status === "pending"
												? `Cancel ${connector.name}`
												: `Connect ${connector.name}`
										}
										disabled={busy}
										onClick={(event) =>
											status === "pending"
												? onCancel(connector.slug)
												: onConnect(
														connector.slug,
														primaryButtons.get(connector.slug) ??
															event.currentTarget,
													)
										}
										size="xs"
										tone="neutral"
										type="button"
										variant="secondary"
										icon={Plus}
										loading={busy || status === "pending"}
										iconTone="muted"
									/>
								) : null}
							</ButtonGroup>
						);
					})}
				</div>
			</div>
		</ItemCard>
	);
}
