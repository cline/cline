import type { GlobalInstructionsFile, RemoteConfig } from "@clinebot/shared";
import type {
	EnterpriseConfigBundle,
	EnterpriseMaterializationInput,
	EnterpriseMaterializationResult,
	EnterprisePolicyMaterializer,
	EnterpriseRuleFile,
	EnterpriseRuleKind,
	MaterializedInstructionFile,
} from "../contracts";

function sanitizeSegment(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "item"
	);
}

function mergeRemoteConfigInstructions(
	remoteConfig: RemoteConfig | undefined,
): EnterpriseRuleFile[] {
	const rules =
		remoteConfig?.globalRules?.map((rule, index) =>
			toRuleFile("rule", rule, `${index}`),
		) ?? [];
	const workflows =
		remoteConfig?.globalWorkflows?.map((workflow, index) =>
			toRuleFile("workflow", workflow, `${index}`),
		) ?? [];
	return [...rules, ...workflows];
}

function toRuleFile(
	kind: EnterpriseRuleKind,
	file: GlobalInstructionsFile,
	suffix: string,
): EnterpriseRuleFile {
	return {
		id: `remote-config:${kind}:${suffix}:${file.name}`,
		name: file.name,
		kind,
		contents: file.contents,
		alwaysEnabled: file.alwaysEnabled,
	};
}

function combineInstructions(
	bundle: EnterpriseConfigBundle,
): EnterpriseRuleFile[] {
	return [
		...mergeRemoteConfigInstructions(bundle.remoteConfig),
		...(bundle.managedInstructions ?? []),
	];
}

function buildRulesMarkdown(rules: readonly EnterpriseRuleFile[]): string {
	return rules
		.map((rule) => {
			const header = `## ${rule.name}`;
			const meta = rule.alwaysEnabled ? "_Always enabled_\n" : "";
			return `${header}\n\n${meta}${rule.contents.trim()}`;
		})
		.join("\n\n");
}

export class FileSystemEnterprisePolicyMaterializer
	implements EnterprisePolicyMaterializer
{
	async materialize(
		input: EnterpriseMaterializationInput,
	): Promise<EnterpriseMaterializationResult> {
		const instructions = combineInstructions(input.bundle);
		const rules = instructions.filter((item) => item.kind === "rule");
		const workflows = instructions.filter((item) => item.kind === "workflow");
		const skills = instructions.filter((item) => item.kind === "skill");

		await input.artifactStore.removeChildren(input.paths.workflowsPath);
		await input.artifactStore.removeChildren(input.paths.skillsPath);

		const files: MaterializedInstructionFile[] = [];
		if (rules.length > 0) {
			await input.artifactStore.writeText(
				input.paths.rulesFilePath,
				buildRulesMarkdown(rules),
			);
			files.push(
				...rules.map((rule) => ({
					kind: rule.kind,
					filePath: input.paths.rulesFilePath,
					id: rule.id,
					name: rule.name,
				})),
			);
		} else {
			await input.artifactStore.remove(input.paths.rulesFilePath);
		}

		for (const workflow of workflows) {
			const filePath = `${input.paths.workflowsPath}/${sanitizeSegment(
				workflow.name.replace(/\.(md|markdown|txt)$/i, ""),
			)}.md`;
			await input.artifactStore.writeText(filePath, workflow.contents);
			files.push({
				kind: workflow.kind,
				filePath,
				id: workflow.id,
				name: workflow.name,
			});
		}

		for (const skill of skills) {
			const filePath = `${input.paths.skillsPath}/${sanitizeSegment(
				skill.name,
			)}/SKILL.md`;
			await input.artifactStore.writeText(filePath, skill.contents);
			files.push({
				kind: skill.kind,
				filePath,
				id: skill.id,
				name: skill.name,
			});
		}

		await input.artifactStore.writeText(
			input.paths.manifestPath,
			JSON.stringify(
				{
					source: input.bundle.source,
					version: input.bundle.version,
					files,
				},
				null,
				2,
			),
		);

		return {
			paths: input.paths,
			rulesFilePath: rules.length > 0 ? input.paths.rulesFilePath : undefined,
			files,
		};
	}
}
