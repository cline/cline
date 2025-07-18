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
		 * @deprecated Use getHostBridgeProvider().workspaceClient.getWorkspacePaths({}) instead of vscode.workspace.workspaceFolders.
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
		 * @deprecated Use getHostBridgeProvider().windowClient.showMessage instead of vscode.window.showOpenDialog.
		 * This provides a consistent abstraction across VSCode and standalone environments.
		 * @internal
		 */
		export function showOpenDialog(options?: OpenDialogOptions): Thenable<Uri[] | undefined>
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
