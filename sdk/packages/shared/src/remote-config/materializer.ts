import type {
	RemoteConfigBundle,
	RemoteConfigManagedInstructionFile,
	RemoteConfigManagedInstructionKind,
	RemoteConfigMaterializationInput,
	RemoteConfigMaterializationResult,
	RemoteConfigMaterializedInstructionFile,
	RemoteConfigPolicyMaterializer,
} from "./bundle";
import { remoteConfigInstructionToManagedFile } from "./bundle";
import type { RemoteConfig } from "./schema";

function sanitizeSegment(value: string): string {
	let result = "";
	let pendingSeparator = false;
	for (const char of value.trim().toLowerCase()) {
		const code = char.charCodeAt(0);
		const isAllowed =
			(code >= 97 && code <= 122) ||
			(code >= 48 && code <= 57) ||
			char === "." ||
			char === "_" ||
			char === "-";
		if (isAllowed) {
			if (pendingSeparator && result && result[result.length - 1] !== "-") {
				result += "-";
			}
			pendingSeparator = false;
			result += char;
		} else {
			pendingSeparator = true;
		}
		if (result.length >= 80) {
			break;
		}
	}
	while (result.endsWith("-")) {
		result = result.slice(0, -1);
	}
	while (result.startsWith("-")) {
		result = result.slice(1);
	}
	return result || "item";
}

function mergeRemoteConfigInstructions(
	remoteConfig: RemoteConfig | undefined,
): RemoteConfigManagedInstructionFile[] {
	const rules =
		remoteConfig?.globalRules?.map((rule, index) =>
			remoteConfigInstructionToManagedFile("rule", rule, `${index}`),
		) ?? [];
	const workflows =
		remoteConfig?.globalWorkflows?.map((workflow, index) =>
			remoteConfigInstructionToManagedFile("workflow", workflow, `${index}`),
		) ?? [];
	return [...rules, ...workflows];
}

function combineInstructions(
	bundle: RemoteConfigBundle,
): RemoteConfigManagedInstructionFile[] {
	return [
		...mergeRemoteConfigInstructions(bundle.remoteConfig),
		...(bundle.managedInstructions ?? []),
	];
}

function buildRulesMarkdown(
	rules: readonly RemoteConfigManagedInstructionFile[],
): string {
	return rules
		.map((rule) => {
			const header = `## ${rule.name}`;
			const meta = rule.alwaysEnabled ? "_Always enabled_\n" : "";
			return `${header}\n\n${meta}${rule.contents.trim()}`;
		})
		.join("\n\n");
}

function selectInstructions(
	instructions: readonly RemoteConfigManagedInstructionFile[],
	kind: RemoteConfigManagedInstructionKind,
): RemoteConfigManagedInstructionFile[] {
	return instructions.filter((item) => item.kind === kind);
}

export class FileSystemRemoteConfigPolicyMaterializer
	implements RemoteConfigPolicyMaterializer
{
	async materialize(
		input: RemoteConfigMaterializationInput,
	): Promise<RemoteConfigMaterializationResult> {
		const instructions = combineInstructions(input.bundle);
		const rules = selectInstructions(instructions, "rule");
		const workflows = selectInstructions(instructions, "workflow");
		const skills = selectInstructions(instructions, "skill");

		await input.artifactStore.removeChildren(input.paths.workflowsPath);
		await input.artifactStore.removeChildren(input.paths.skillsPath);

		const files: RemoteConfigMaterializedInstructionFile[] = [];
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
