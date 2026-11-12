import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
	type FactoryTaskConfig,
	type FactoryWorkflowRecipe,
	factoryWorkflowConfigSchema,
	factoryWorkflowRecipeSchema,
} from "@cline/shared";
import { normalizeAgendaTaskLocation } from "./task-location";

export function createFactoryWorkflowRecipe(input: {
	name: string;
	config: unknown;
}): FactoryWorkflowRecipe {
	const config = factoryWorkflowConfigSchema.parse(input.config);
	// Schema parsing fixes property order, defaults and legacy agent aliases.
	const revision = createHash("sha256")
		.update(JSON.stringify(config))
		.digest("hex");
	return factoryWorkflowRecipeSchema.parse({
		schemaVersion: 1,
		name: input.name,
		revision,
		config,
	});
}

export function validateFactoryWorkflowRecipe(
	value: unknown,
): FactoryWorkflowRecipe {
	const recipe = factoryWorkflowRecipeSchema.parse(value);
	const canonical = createFactoryWorkflowRecipe(recipe);
	if (recipe.revision !== canonical.revision)
		throw new Error("Workflow revision does not match its configuration");
	return canonical;
}

/**
 * The placeholder name a card's workflow gets when no recipe was chosen. It
 * names the card's own configuration, not a recipe from anywhere.
 */
export const FACTORY_CUSTOM_WORKFLOW_NAME = "Custom workflow";

export function normalizeFactoryTaskWorkflow(
	config: FactoryTaskConfig,
): FactoryTaskConfig {
	const recipe = createFactoryWorkflowRecipe({
		name: config.workflow?.name ?? FACTORY_CUSTOM_WORKFLOW_NAME,
		config,
	});
	return {
		...config,
		workflow: { name: recipe.name, revision: recipe.revision },
	};
}

export async function readFactoryWorkflowFile(input: {
	workspaceRoot: string;
	path: string;
}): Promise<FactoryWorkflowRecipe> {
	if (isAbsolute(input.path))
		throw new Error("Workflow path must be relative to the repository");
	const location = normalizeAgendaTaskLocation({
		scope: "workspace",
		workspaceRoot: input.workspaceRoot,
		resourcePaths: [input.path],
	});
	const path = location.resourcePaths[0];
	if (!path) throw new Error("Workflow path is required");
	return validateFactoryWorkflowRecipe(
		JSON.parse(await readFile(resolve(input.workspaceRoot, path), "utf8")),
	);
}
