"use client";

import { Button, DetailList, DetailListItem, Switch } from "@cline/ui";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { useIsMounted } from "@/hooks/use-is-mounted";
import type { SkillItem } from "@/lib/extension-inventory";
import {
	getCachedMarketplaceCatalog,
	type MarketplaceEntry,
} from "@/lib/marketplace";
import {
	extensionActionKey,
	useExtensionActions,
} from "@/lib/use-extension-actions";
import { useExtensionInventory } from "@/lib/use-extension-inventory";
import { MarketplaceEntryDetails } from "../marketplace/marketplace-entry-details";
import {
	InstalledSkillPreview,
	MarketplaceSkillPreview,
} from "../marketplace/marketplace-skill-preview";
import { CustomizationDeleteDialog } from "../shared/customization-delete-dialog";
import { CustomizationDetailPage } from "../shared/customization-detail-page";
import { PathDetailListItem } from "../shared/path-detail-list-item";

type InstalledSkill = SkillItem & { scope?: string };

export type InstalledSkillSelection =
	| { skill: InstalledSkill; entry?: MarketplaceEntry }
	| { skill?: undefined; entry: MarketplaceEntry };

function skillEntry(
	skill: InstalledSkill | undefined,
	entry: MarketplaceEntry | undefined,
): MarketplaceEntry {
	if (!skill && entry) return entry;
	if (!skill) throw new Error("An installed skill is required");
	return {
		...entry,
		id: entry?.id ?? skill.path,
		type: "skill",
		name: entry?.name ?? skill.name,
		tagline: entry?.tagline || "",
		description: skill.description?.trim() || entry?.description || "",
		tags: entry?.tags ?? [],
		install: entry?.install ?? { command: "", args: [] },
	};
}

function installedScope(
	skill: InstalledSkill,
	root?: string,
): string | undefined {
	if (skill.scope) return skill.scope;
	const workspaceRoot = root?.replaceAll("\\", "/").replace(/\/+$/, "");
	if (!workspaceRoot) return undefined;
	return skill.path.replaceAll("\\", "/").startsWith(`${workspaceRoot}/`)
		? "Project"
		: "Global";
}

function InstalledSkillDetails({
	selection,
	onBack,
}: {
	selection: InstalledSkillSelection;
	onBack: (options?: { uninstalled: boolean }) => void;
}) {
	const { inventory, loading, error: inventoryError } = useExtensionInventory();
	const actions = useExtensionActions();
	const selectedSkill = selection.skill;
	const currentSkill = selectedSkill
		? inventory?.skills.find((item) => item.path === selectedSkill.path)
		: undefined;
	const skill = currentSkill
		? { ...currentSkill, scope: selectedSkill?.scope }
		: selectedSkill;
	const entry = skillEntry(skill, selection.entry);
	const action = actions.actions.get(
		extensionActionKey("skill", skill?.path ?? `catalog:${entry.id}`),
	);
	const pending = action?.pending ?? null;
	const error = action?.error ?? inventoryError;
	const [uninstallOpen, setUninstallOpen] = useState(false);
	const mounted = useIsMounted();
	const returnedFromDetail = useRef(false);
	useEffect(() => {
		if (
			selectedSkill &&
			inventory &&
			!loading &&
			!inventoryError &&
			!currentSkill &&
			!returnedFromDetail.current
		) {
			returnedFromDetail.current = true;
			onBack({ uninstalled: true });
		}
	}, [selectedSkill, inventory, loading, inventoryError, currentSkill, onBack]);

	const scope = skill
		? installedScope(skill, inventory?.workspaceRoot)
		: undefined;
	const enabled = skill?.enabled !== false;
	const pluginManaged = skill?.agentPlugin === true;
	const tagLabels = new Map(
		getCachedMarketplaceCatalog()?.tags.map((tag) => [tag.id, tag.label]) ?? [],
	);
	const toggleSkill = () => {
		if (skill && !pluginManaged) void actions.toggleSkill(skill);
	};
	const uninstallSkill = async () => {
		if (pluginManaged) return;
		const result = await actions.uninstallSkill(skill, entry);
		if (
			result.status === "succeeded" &&
			mounted.current &&
			!returnedFromDetail.current
		) {
			returnedFromDetail.current = true;
			onBack({ uninstalled: true });
		}
	};

	return (
		<MarketplaceEntryDetails
			actions={
				!pluginManaged ? (
					<>
						<Button
							disabled={pending !== null}
							onClick={() => setUninstallOpen(true)}
							size="sm"
							tone="destructive"
							type="button"
							variant="secondary"
							leadingIcon={Trash2}
							loading={pending === "uninstall"}
						>
							{pending === "uninstall" ? "Uninstalling…" : "Uninstall"}
						</Button>
						<CustomizationDeleteDialog
							open={uninstallOpen}
							type="skill"
							name={entry.name}
							busy={pending !== null}
							onClose={() => setUninstallOpen(false)}
							onConfirm={() => void uninstallSkill()}
						/>
					</>
				) : null
			}
			entry={entry}
			onCategorySelected={onBack}
			feedback={
				error ? (
					<p className="mt-2 text-error-text text-sm" role="alert">
						{error}
					</p>
				) : undefined
			}
			leadingActions={
				skill ? (
					<div className="flex items-center gap-3">
						<Switch
							aria-label={`Enable ${skill.name}`}
							checked={enabled}
							disabled={pluginManaged || pending !== null}
							onCheckedChange={() => void toggleSkill()}
							title={
								pluginManaged ? "Managed by the installed plugin" : undefined
							}
						/>
						<span className="text-sm">Enable</span>
						{pending === "toggle" ? <Spinner /> : null}
					</div>
				) : undefined
			}
			metadata={
				skill ? (
					<DetailList>
						{scope ? (
							<DetailListItem title="Scope" trailingText={scope} />
						) : null}
						{skill.pluginName || pluginManaged ? (
							<DetailListItem
								title="Plugin"
								trailingText={skill.pluginName || "Agent Plugin"}
							/>
						) : null}
						<PathDetailListItem
							path={skill.path}
							label="Skill path"
							title="Path"
							trailingText={<span className="break-all">{skill.path}</span>}
						/>
					</DetailList>
				) : undefined
			}
			skillContent={
				skill ? (
					<InstalledSkillPreview
						instructions={skill.instructions}
						skillPath={skill.path}
					/>
				) : (
					<MarketplaceSkillPreview entry={entry} />
				)
			}
			tagLabels={tagLabels}
		/>
	);
}

export function InstalledSkillDetailPage({
	selection,
	onBack,
	backLabel = "Manage",
}: {
	selection: InstalledSkillSelection;
	onBack: (options?: { uninstalled: boolean }) => void;
	backLabel?: string;
}) {
	return (
		<CustomizationDetailPage
			backLabel={backLabel}
			onBack={onBack}
			navigationLabel="Skill navigation"
		>
			<InstalledSkillDetails
				key={selection.skill ? selection.skill.path : selection.entry.id}
				onBack={onBack}
				selection={selection}
			/>
		</CustomizationDetailPage>
	);
}
