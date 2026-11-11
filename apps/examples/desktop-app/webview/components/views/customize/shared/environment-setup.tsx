import { Badge, Button, DetailList, DetailListItem } from "@cline/ui";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { openExternalUrl } from "@/lib/desktop-client";
import type { MarketplaceEntry } from "@/lib/marketplace";

type EnvironmentRequirement = NonNullable<
	MarketplaceEntry["install"]["env"]
>[number];

/** Required values come before optional ones. */
function requiredFirst(requirements: EnvironmentRequirement[]) {
	return [
		...requirements.filter((env) => env.required !== false),
		...requirements.filter((env) => env.required === false),
	];
}

/** The values an entry needs, as a list on its detail page. */
export function EnvironmentRequirements({
	requirements,
}: {
	requirements: EnvironmentRequirement[];
}) {
	return (
		<DetailList>
			{requiredFirst(requirements).map((env) => (
				<DetailListItem
					key={env.name}
					title={
						<>
							<code className="font-mono">{env.name}</code>
							<Badge className="font-mono" size="xxs">
								{env.required === false ? "Optional" : "Required"}
							</Badge>
						</>
					}
					description={env.description}
					actions={
						env.url ? (
							<Button
								onClick={() => {
									if (env.url) void openExternalUrl(env.url);
								}}
								size="xs"
								tone="neutral"
								type="button"
								variant="secondary"
								trailingIcon={ArrowUpRight}
							>
								Get value
							</Button>
						) : null
					}
				/>
			))}
		</DetailList>
	);
}

/** The same values as compact cards, for setup guidance shown as a warning. */
export function EnvironmentRequirementCards({
	requirements,
}: {
	requirements: EnvironmentRequirement[];
}) {
	return (
		<div className="mt-3 grid gap-2">
			{requiredFirst(requirements).map((env) => (
				<div
					className="rounded-md border border-warning-border bg-background/60 p-2 text-foreground"
					key={env.name}
				>
					<div className="min-w-0">
						<div className="flex items-center justify-between gap-2">
							<code className="font-mono font-semibold text-xs">
								<span
									style={{
										fontFamily:
											'"Geist Mono Variable", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
									}}
								>
									{env.name}
								</span>
							</code>
							<Badge size="xs">
								{env.required === false ? "Optional" : "Required"}
							</Badge>
						</div>
						{env.description ? (
							<p className="mt-1 text-muted-foreground text-xs">
								{env.description}
							</p>
						) : null}
					</div>
					{env.url ? (
						<a
							className="mt-1 inline-flex items-center gap-1 text-primary text-xs hover:underline"
							href={env.url}
							onAuxClick={(event) => {
								if (event.button !== 1) return;
								event.preventDefault();
								if (env.url) void openExternalUrl(env.url);
							}}
							onClick={(event) => {
								event.preventDefault();
								if (env.url) void openExternalUrl(env.url);
							}}
							rel="noreferrer"
							target="_blank"
						>
							Get value
							<ExternalLink className="size-3" />
						</a>
					) : null}
				</div>
			))}
		</div>
	);
}

export function InstallationNotes({ notes }: { notes?: string }) {
	return notes ? (
		<p className="rounded-lg border bg-muted/30 p-3 text-muted-foreground text-xs leading-5">
			{notes}
		</p>
	) : null;
}
