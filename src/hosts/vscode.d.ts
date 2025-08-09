/// <reference types="vscode" />
/**
 * TypeScript declaration overrides to show deprecation warnings for direct VSCode API usage.
 * These APIs should be accessed through Cline's abstraction layers instead.
 *
 * This approach uses TypeScript's module augmentation to add deprecation warnings
 * and make the APIs less discoverable in IntelliSense by marking them as @internal.
 *
 * Exemptions: Files in src/hosts/vscode/ and standalone/runtime-files/ directories
 * are allowed to use these APIs directly as they provide the abstraction layer.
 */

declare module "vscode" {
	type CompileTimeError<T extends string> = { __errorMessage: T } & { __error: "ERROR" }
	type HostBridgeError = "HostBridgeError" | "HostBridgeNotAvailableError"

	export interface ExtensionContext {
		/**
		 * @deprecated Use gRPC service clients instead of vscode.postMessage().
		 * Example: AccountServiceClient.methodName(RequestType.create({...})) instead of vscode.postMessage({type: '...'}).
		 * This provides better type safety and consistent communication patterns.
		 * @internal
		 */
		postMessage?: (message: any) => Thenable<boolean>
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
