/// <reference types="vscode" />
/**
 * TypeScript declaration overrides to show deprecation warnings for direct VSCode API usage.
 * These APIs should be accessed through Cline's abstraction layers instead.
 *
 * This approach uses TypeScript's module augmentation to add deprecation warnings
 * and make them discoverable in IntelliSense by marking them as @internal.
 *
 * Exemptions: Files in src/hosts/vscode/ and standalone/runtime-files/ directories
 * are allowed to use these APIs directly as they provide the abstraction layer.
 *
 * To ensure error on usage, update src/dev/grit/vscode-api.grit to include the banned apis.
 */

declare module "vscode" {
	export interface ExtensionContext {
		/**
		 * @deprecated Use gRPC service clients instead of vscode.postMessage().
		 * Example: AccountServiceClient.methodName(RequestType.create({...})) instead of vscode.postMessage({type: '...'}).
		 * This provides better type safety and consistent communication patterns.
		 * @internal
		 */
		postMessage?: (message: any) => Thenable<boolean>

		/**
		 * @deprecated Use CacheService.getGlobalStateKey() instead of context.globalState.get().
		 * Example: cacheService.getGlobalStateKey('myKey') instead of context.globalState.get('myKey').
		 * This provides better performance with in-memory caching and consistent state management.
		 * @internal
		 */
		readonly globalState: {
			/**
			 * @deprecated Use CacheService.getGlobalStateKey() instead of context.globalState.get().
			 * Example: cacheService.getGlobalStateKey('myKey') instead of context.globalState.get('myKey').
			 * This provides better performance with in-memory caching and consistent state management.
			 * @internal
			 */
			get<T>(key: string): T | undefined
			/**
			 * @deprecated Use CacheService.setGlobalState() instead of context.globalState.update().
			 * Example: cacheService.setGlobalState('myKey', value) instead of context.globalState.update('myKey', value).
			 * This provides better performance with in-memory caching and consistent state management.
			 * @internal
			 */
			update(key: string, value: any): Thenable<void>
		}

		/**
		 * @deprecated Use CacheService.getWorkspaceStateKey() instead of context.workspaceState.get().
		 * Example: cacheService.getWorkspaceStateKey('myKey') instead of context.workspaceState.get('myKey').
		 * This provides better performance with in-memory caching and consistent state management.
		 * @internal
		 */
		readonly workspaceState: {
			/**
			 * @deprecated Use CacheService.getWorkspaceStateKey() instead of context.workspaceState.get().
			 * Example: cacheService.getWorkspaceStateKey('myKey') instead of context.workspaceState.get('myKey').
			 * This provides better performance with in-memory caching and consistent state management.
			 * @internal
			 */
			get<T>(key: string): T | undefined
			/**
			 * @deprecated Use CacheService.setWorkspaceState() instead of context.workspaceState.update().
			 * Example: cacheService.setWorkspaceState('myKey', value) instead of context.workspaceState.update('myKey', value).
			 * This provides better performance with in-memory caching and consistent state management.
			 * @internal
			 */
			update(key: string, value: any): Thenable<void>
		}

		/**
		 * @deprecated Use CacheService.getSecretKey() and CacheService.setSecret() instead of context.secrets.
		 * Example: cacheService.getSecretKey('apiKey') instead of context.secrets.get('apiKey').
		 * This provides better performance with in-memory caching and consistent state management.
		 * @internal
		 */
		readonly secrets: {
			/**
			 * @deprecated Use CacheService.getSecretKey() instead of context.secrets.get().
			 * Example: cacheService.getSecretKey('apiKey') instead of context.secrets.get('apiKey').
			 * This provides better performance with in-memory caching and consistent state management.
			 * @internal
			 */
			get(key: string): Thenable<string | undefined>
			/**
			 * @deprecated Use CacheService.setSecret() instead of context.secrets.store().
			 * Example: cacheService.setSecret('apiKey', value) instead of context.secrets.store('apiKey', value).
			 * This provides better performance with in-memory caching and consistent state management.
			 * @internal
			 */
			store(key: string, value: string): Thenable<void>
			/**
			 * @deprecated Use CacheService.setSecret() with undefined instead of context.secrets.delete().
			 * Example: cacheService.setSecret('apiKey', undefined) instead of context.secrets.delete('apiKey').
			 * This provides better performance with in-memory caching and consistent state management.
			 * @internal
			 */
			delete(key: string): Thenable<void>
		}
	}

	export namespace workspace {
		export namespace fs {
			/**
			 * @deprecated Use utilities in @/utils/fs instead of vscode.workspace.fs.stat.
			 * Example: import { isDirectory } from '@/utils/fs' or use the file system methods from the host bridge provider.
			 * This provides consistent file system access across VSCode and standalone environments.
			 * @internal
			 */
			export function stat(uri: Uri): Thenable<FileStat>

			/**
			 * @deprecated Use utilities in @/utils/fs instead of vscode.workspace.fs.writeFile.
			 * Example: import { writeFile } from '@/utils/fs' or use the file system methods from the host bridge provider.
			 * This provides consistent file system access across VSCode and standalone environments.
			 * @internal
			 */
			export function writeFile(uri: Uri, content: Uint8Array): Thenable<void>
		}

		/**
		 * @deprecated Use HostProvider.workspace.getWorkspacePaths({}) instead of vscode.workspace.workspaceFolders.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export const workspaceFolders: readonly WorkspaceFolder[] | undefined

		/**
		 * @deprecated Use path utilities from @/utils/path instead of vscode.workspace.asRelativePath.
		 * This provides consistent path handling across different environments.
		 * @internal
		 */
		export function asRelativePath(pathOrUri: string | Uri, includeWorkspaceFolder?: boolean): string

		/**
		 * @deprecated Use path utilities from @/utils/path instead of vscode.workspace.getWorkspaceFolder.
		 * This provides consistent path handling across different environments.
		 * @internal
		 */
		export function getWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined

		/**
		 * @deprecated Use the host bridge instead of vscode.workspace.applyEdit.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export function applyEdit(edit: WorkspaceEdit): Thenable<boolean>

		/**
		 * @deprecated Use a native JavaScript API instead of vscode.workspace.findFiles.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export function findFiles(
			include: GlobPattern,
			exclude?: GlobPattern | null,
			maxResults?: number,
			token?: CancellationToken,
		): Thenable<Uri[]>
	}

	export namespace env {
		/**
		 * @deprecated Use utilities in @/utils instead of vscode.env.openExternal.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export function openExternal(target: Uri): Thenable<boolean>
	}

	export namespace window {
		/**
		 * @deprecated Use the host bridge instead of vscode.window.showTextDocument.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export function showTextDocument(
			document: TextDocument | Uri,
			column?: ViewColumn,
			preserveFocus?: boolean,
		): Thenable<TextEditor>
		/**
		 * @deprecated Use HostProvider.window.showMessage instead of vscode.window.showWarningMessage.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export function showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>
		/**
		 * @deprecated Use HostProvider.window.showMessage instead of vscode.window.showErrorMessage.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export function showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>
		/**
		 * @deprecated Use HostProvider.window.showMessage instead of vscode.window.showInformationMessage.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export function showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>

		/**
		 * @deprecated Use HostProvider.window.showMessage instead of vscode.window.showOpenDialog.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export function showOpenDialog(options?: OpenDialogOptions): Thenable<Uri[] | undefined>

		/**
		 * @deprecated Use the host bridge instead of vscode.window.showInputBox.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export function showInputBox(options?: InputBoxOptions, token?: CancellationToken): Thenable<string | undefined>

		/**
		 * @deprecated Use the host bridge instead of vscode.window.onDidChangeActiveTextEditor.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export const onDidChangeActiveTextEditor: Event<TextEditor | undefined>
	}

	export interface Webview {
		/**
		 * @deprecated Use gRPC service clients instead of webview.postMessage().
		 * Example: AccountServiceClient.methodName(RequestType.create({...})) instead of webview.postMessage({type: '...'}).
		 * This provides better type safety and consistent communication patterns.
		 * @internal
		 */
		postMessage(message: any): Thenable<boolean>
	}

	export interface WebviewPanel {
		/**
		 * Access to the webview belonging to this panel.
		 * Note: webview.postMessage is deprecated - use gRPC service clients instead.
		 */
		readonly webview: Webview
	}
}
