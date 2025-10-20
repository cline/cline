/**
 * Plugin API Export
 *
 * Public API for third-party VS Code extensions to register plugins with Cline.
 * This API is exported through Cline's extension exports and accessed by plugin extensions.
 */

import * as vscode from "vscode"
import type { PluginHub } from "../services/plugins/PluginHub"
import type { ClinePlugin, ClinePluginAPI } from "../services/plugins/types"

/**
 * Create the plugin API that will be exported by Cline.
 * Plugin extensions access this through vscode.extensions.getExtension().exports.plugins
 *
 * @param pluginHub - The plugin hub instance from the controller
 * @returns The plugin API object
 */
export function createPluginAPI(pluginHub: PluginHub): ClinePluginAPI {
	return {
		/**
		 * Register a plugin with Cline.
		 * This should be called during the plugin extension's activation.
		 *
		 * @param plugin - The plugin instance to register
		 * @throws Error if registration fails or plugin is invalid
		 *
		 * @example
		 * ```typescript
		 * // In plugin extension's activate() function
		 * const clineApi = vscode.extensions.getExtension('saoudrizwan.claude-dev')?.exports
		 * const myPlugin = new MyPlugin()
		 * await clineApi.plugins.registerPlugin(myPlugin)
		 * ```
		 */
		async registerPlugin(plugin: ClinePlugin): Promise<void> {
			// Get the calling extension's ID
			const extensionId = getCallingExtensionId()

			if (!extensionId) {
				throw new Error(
					"Unable to determine calling extension ID. " +
						"registerPlugin must be called from an activated VS Code extension.",
				)
			}

			// Validate plugin before passing to hub
			validatePlugin(plugin)

			// Register with the hub
			await pluginHub.registerPlugin(plugin, extensionId)
		},

		/**
		 * Unregister a previously registered plugin.
		 * This should be called during the plugin extension's deactivation.
		 *
		 * @param pluginId - ID of the plugin to unregister
		 *
		 * @example
		 * ```typescript
		 * // In plugin extension's deactivate() function
		 * const clineApi = vscode.extensions.getExtension('saoudrizwan.claude-dev')?.exports
		 * await clineApi.plugins.unregisterPlugin('my-plugin-id')
		 * ```
		 */
		async unregisterPlugin(pluginId: string): Promise<void> {
			if (!pluginId || typeof pluginId !== "string") {
				throw new Error("Plugin ID must be a non-empty string")
			}

			await pluginHub.unregisterPlugin(pluginId)
		},
	}
}

/**
 * Get the ID of the extension that is calling this API.
 * Uses the call stack to determine which extension made the call.
 *
 * @returns Extension ID or undefined if it cannot be determined
 */
function getCallingExtensionId(): string | undefined {
	try {
		// Get call stack
		const stack = new Error().stack

		if (!stack) {
			return undefined
		}

		// Parse the stack to find the calling extension
		// Stack traces typically contain file paths that include the extension ID
		const lines = stack.split("\n")

		for (const line of lines) {
			// Look for patterns like:
			// at /Users/username/.vscode/extensions/publisher.extension-name-version/...
			// or C:\Users\username\.vscode\extensions\publisher.extension-name-version\...
			const extensionMatch = line.match(/\.vscode[/\\]extensions[/\\]([^/\\]+)[/\\]/)

			if (extensionMatch && extensionMatch[1]) {
				// Extract publisher.extension-name from publisher.extension-name-version
				const fullName = extensionMatch[1]
				const versionMatch = fullName.match(/^(.+?)-\d+\.\d+\.\d+/)

				return versionMatch ? versionMatch[1] : fullName
			}
		}

		// Alternative approach: check all active extensions to find which one is in the stack
		for (const ext of vscode.extensions.all) {
			if (ext.isActive && ext.extensionPath && stack.includes(ext.extensionPath)) {
				return ext.id
			}
		}

		return undefined
	} catch (error) {
		console.error("[PluginAPI] Error determining calling extension ID:", error)
		return undefined
	}
}

/**
 * Validate a plugin object before registration.
 * Provides early validation and helpful error messages.
 *
 * @param plugin - The plugin to validate
 * @throws Error if validation fails
 */
function validatePlugin(plugin: ClinePlugin): void {
	if (!plugin || typeof plugin !== "object") {
		throw new Error("Plugin must be a valid object")
	}

	// Validate required fields
	if (!plugin.id || typeof plugin.id !== "string") {
		throw new Error("Plugin must have a valid 'id' property (string). " + "Typically this should be your extension ID.")
	}

	if (plugin.id.trim() === "") {
		throw new Error("Plugin ID cannot be empty")
	}

	if (!plugin.name || typeof plugin.name !== "string") {
		throw new Error("Plugin must have a valid 'name' property (string)")
	}

	if (plugin.name.trim() === "") {
		throw new Error("Plugin name cannot be empty")
	}

	if (!plugin.version || typeof plugin.version !== "string") {
		throw new Error("Plugin must have a valid 'version' property (string). " + "Use semantic versioning (e.g., '1.0.0')")
	}

	// Validate version format (basic semver check)
	const versionRegex = /^\d+\.\d+\.\d+/
	if (!versionRegex.test(plugin.version)) {
		throw new Error(`Plugin version '${plugin.version}' is not valid. ` + "Use semantic versioning format (e.g., '1.0.0')")
	}

	// Validate required methods
	if (typeof plugin.getCapabilities !== "function") {
		throw new Error("Plugin must implement 'getCapabilities()' method that returns Promise<PluginCapability[]>")
	}

	if (typeof plugin.executeCapability !== "function") {
		throw new Error("Plugin must implement 'executeCapability(name, params, context)' method that returns Promise<any>")
	}

	// Validate optional fields
	if (plugin.description !== undefined && typeof plugin.description !== "string") {
		throw new Error("Plugin 'description' property must be a string if provided")
	}

	if (plugin.dispose !== undefined && typeof plugin.dispose !== "function") {
		throw new Error("Plugin 'dispose' property must be a function if provided")
	}
}
