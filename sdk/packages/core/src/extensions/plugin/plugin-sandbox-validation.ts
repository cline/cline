/**
 * Shape checks the plugin sandbox bootstrap runs on what it hands a plugin.
 * Kept free of side effects so the checks can be tested without starting a
 * sandbox; the bootstrap bundles this file.
 */

export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function hasValidStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
}

export function assertValidPluginSetupCtx(ctx: unknown): void {
	if (!isObject(ctx)) {
		throw new Error("Plugin setup context must be an object");
	}
	if (ctx.session !== undefined && !isObject(ctx.session)) {
		throw new Error("Plugin setup context session must be an object");
	}
	if (ctx.client !== undefined && !isObject(ctx.client)) {
		throw new Error("Plugin setup context client must be an object");
	}
	if (ctx.user !== undefined && !isObject(ctx.user)) {
		throw new Error("Plugin setup context user must be an object");
	}
	if (ctx.workspaceInfo !== undefined && !isObject(ctx.workspaceInfo)) {
		throw new Error("Plugin setup context workspaceInfo must be an object");
	}
	if (ctx.automation !== undefined && !isObject(ctx.automation)) {
		throw new Error("Plugin setup context automation must be an object");
	}
	if (
		ctx.automation !== undefined &&
		typeof ctx.automation.ingestEvent !== "function"
	) {
		throw new Error(
			"Plugin setup context automation.ingestEvent must be a function",
		);
	}
	if (ctx.logger !== undefined && !isObject(ctx.logger)) {
		throw new Error("Plugin setup context logger must be an object");
	}
	if (ctx.ui !== undefined && !isObject(ctx.ui)) {
		throw new Error("Plugin setup context ui must be an object");
	}
	if (ctx.ui !== undefined && !hasValidStringArray(ctx.ui.slots)) {
		throw new Error("Plugin setup context ui.slots must be a string array");
	}
	if (ctx.ui !== undefined && typeof ctx.ui.update !== "function") {
		throw new Error("Plugin setup context ui.update must be a function");
	}
}
