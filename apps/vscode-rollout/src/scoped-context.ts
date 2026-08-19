import path from "node:path";
import * as vscode from "vscode";
import type { Bundle } from "./cohort";

/**
 * Wrap the real ExtensionContext so a bundle living under `<vsix root>/<sub>/`
 * resolves extension-root-relative resources (webview-ui build, walkthrough
 * assets, bundled codicons, ...) from its own subtree, without either codebase
 * knowing it was relocated.
 *
 * Only install-root properties are redirected. Storage-related properties
 * (globalState, workspaceState, secrets, globalStorageUri, storageUri, logUri)
 * intentionally pass through untouched: both bundles must keep sharing the
 * exact storage the standalone extension used, so user state survives cohort
 * changes and VSIX upgrades.
 */
export function scopedContext(
	context: vscode.ExtensionContext,
	sub: Bundle,
): vscode.ExtensionContext {
	const extensionUri = vscode.Uri.joinPath(context.extensionUri, sub);
	const extensionPath = extensionUri.fsPath;

	const scopedExtension = new Proxy(context.extension, {
		get(target, prop, _receiver) {
			if (prop === "extensionUri") {
				return extensionUri;
			}
			if (prop === "extensionPath") {
				return extensionPath;
			}
			const value = Reflect.get(target, prop, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

	const overrides = new Map<PropertyKey, unknown>([
		["extensionUri", extensionUri],
		["extensionPath", extensionPath],
		[
			"asAbsolutePath",
			(relativePath: string) => path.join(extensionPath, relativePath),
		],
		["extension", scopedExtension],
	]);

	return new Proxy(context, {
		get(target, prop, _receiver) {
			if (overrides.has(prop)) {
				return overrides.get(prop);
			}
			const value = Reflect.get(target, prop, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as vscode.ExtensionContext;
}
