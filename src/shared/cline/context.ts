/**
 * A Copy of the Type Definition for Visual Studio Code 1.84 Extension API
 * See https://code.visualstudio.com/api for more information
 */

import { URI } from "vscode-uri"
import { ClineMemento, ClineSecretStore } from "../storage"

enum ExtensionMode {
	/**
	 * The extension is installed normally (for example, from the marketplace
	 * or VSIX) in the editor.
	 */
	Production = 1,

	/**
	 * The extension is running from an `--extensionDevelopmentPath` provided
	 * when launching the editor.
	 */
	Development = 2,

	/**
	 * The extension is running from an `--extensionTestsPath` and
	 * the extension host is running unit tests.
	 */
	Test = 3,
}

export interface ClineExtensionContext {
	/**
	 * An array to which disposables can be added. When this
	 * extension is deactivated the disposables will be disposed.
	 *
	 * *Note* that asynchronous dispose-functions aren't awaited.
	 */
	readonly subscriptions: {
		/**
		 * Function to clean up resources.
		 */
		dispose(): any
	}[]

	/**
	 * A memento object that stores state in the context
	 * of the currently opened {@link workspace.workspaceFolders workspace}.
	 */
	readonly workspaceState: ClineMemento

	/**
	 * A memento object that stores state independent
	 * of the current opened {@link workspace.workspaceFolders workspace}.
	 */
	readonly globalState: ClineMemento & {
		/**
		 * Set the keys whose values should be synchronized across devices when synchronizing user-data
		 * like configuration, extensions, and mementos.
		 *
		 * Note that this function defines the whole set of keys whose values are synchronized:
		 *  - calling it with an empty array stops synchronization for this memento
		 *  - calling it with a non-empty array replaces all keys whose values are synchronized
		 *
		 * For any given set of keys this function needs to be called only once but there is no harm in
		 * repeatedly calling it.
		 *
		 * @param keys The set of keys whose values are synced.
		 */
		setKeysForSync(keys: readonly string[]): void
	}

	/**
	 * A storage utility for secrets. Secrets are persisted across reloads and are independent of the
	 * current opened {@link workspace.workspaceFolders workspace}.
	 */
	readonly secrets: ClineSecretStore

	/**
	 * The uri of the directory containing the extension.
	 */
	readonly extensionUri: URI

	/**
	 * The absolute file path of the directory containing the extension. Shorthand
	 * notation for {@link TextDocument.uri ExtensionContext.extensionUri.fsPath} (independent of the uri scheme).
	 */
	readonly extensionPath: string

	/**
	 * Gets the extension's global environment variable collection for this workspace, enabling changes to be
	 * applied to terminal environment variables.
	 */
	readonly environmentVariableCollection: any

	/**
	 * Get the absolute path of a resource contained in the extension.
	 *
	 * *Note* that an absolute uri can be constructed via {@linkcode Uri.joinPath} and
	 * {@linkcode ExtensionContext.extensionUri extensionUri}, e.g. `vscode.Uri.joinPath(context.extensionUri, relativePath);`
	 *
	 * @param relativePath A relative path to a resource contained in the extension.
	 * @returns The absolute path of the resource.
	 */
	asAbsolutePath(relativePath: string): string

	/**
	 * The uri of a workspace specific directory in which the extension
	 * can store private state. The directory might not exist and creation is
	 * up to the extension. However, the parent directory is guaranteed to be existent.
	 * The value is `undefined` when no workspace nor folder has been opened.
	 *
	 * Use {@linkcode ExtensionContext.workspaceState workspaceState} or
	 * {@linkcode ExtensionContext.globalState globalState} to store key value data.
	 *
	 * @see {@linkcode FileSystem workspace.fs} for how to read and write files and folders from
	 *  an uri.
	 */
	readonly storageUri: URI | undefined

	/**
	 * An absolute file path of a workspace specific directory in which the extension
	 * can store private state. The directory might not exist on disk and creation is
	 * up to the extension. However, the parent directory is guaranteed to be existent.
	 *
	 * Use {@linkcode ExtensionContext.workspaceState workspaceState} or
	 * {@linkcode ExtensionContext.globalState globalState} to store key value data.
	 *
	 * @deprecated Use {@link ExtensionContext.storageUri storageUri} instead.
	 */
	readonly storagePath: string | undefined

	/**
	 * The uri of a directory in which the extension can store global state.
	 * The directory might not exist on disk and creation is
	 * up to the extension. However, the parent directory is guaranteed to be existent.
	 *
	 * Use {@linkcode ExtensionContext.globalState globalState} to store key value data.
	 *
	 * @see {@linkcode FileSystem workspace.fs} for how to read and write files and folders from
	 *  an uri.
	 */
	readonly globalStorageUri: URI

	/**
	 * An absolute file path in which the extension can store global state.
	 * The directory might not exist on disk and creation is
	 * up to the extension. However, the parent directory is guaranteed to be existent.
	 *
	 * Use {@linkcode ExtensionContext.globalState globalState} to store key value data.
	 *
	 * @deprecated Use {@link ExtensionContext.globalStorageUri globalStorageUri} instead.
	 */
	readonly globalStoragePath: string

	/**
	 * The uri of a directory in which the extension can create log files.
	 * The directory might not exist on disk and creation is up to the extension. However,
	 * the parent directory is guaranteed to be existent.
	 *
	 * @see {@linkcode FileSystem workspace.fs} for how to read and write files and folders from
	 *  an uri.
	 */
	readonly logUri: URI

	/**
	 * An absolute file path of a directory in which the extension can create log files.
	 * The directory might not exist on disk and creation is up to the extension. However,
	 * the parent directory is guaranteed to be existent.
	 *
	 * @deprecated Use {@link ExtensionContext.logUri logUri} instead.
	 */
	readonly logPath: string

	/**
	 * The mode the extension is running in. See {@link ExtensionMode}
	 * for possible values and scenarios.
	 */
	readonly extensionMode: ExtensionMode

	/**
	 * The current `Extension` instance.
	 */
	readonly extension: Extension<any>
}

export enum ExtensionKind {
	/**
	 * Extension runs where the UI runs.
	 */
	UI = 1,

	/**
	 * Extension runs where the remote extension host runs.
	 */
	Workspace = 2,
}

interface Extension<T> {
	/**
	 * The canonical extension identifier in the form of: `publisher.name`.
	 */
	readonly id: string

	/**
	 * The uri of the directory containing the extension.
	 */
	readonly extensionUri: URI

	/**
	 * The absolute file path of the directory containing this extension. Shorthand
	 * notation for {@link Extension.extensionUri Extension.extensionUri.fsPath} (independent of the uri scheme).
	 */
	readonly extensionPath: string

	/**
	 * `true` if the extension has been activated.
	 */
	readonly isActive: boolean

	/**
	 * The parsed contents of the extension's package.json.
	 */
	readonly packageJSON: any

	/**
	 * The extension kind describes if an extension runs where the UI runs
	 * or if an extension runs where the remote extension host runs. The extension kind
	 * is defined in the `package.json`-file of extensions but can also be refined
	 * via the `remote.extensionKind`-setting. When no remote extension host exists,
	 * the value is {@linkcode ExtensionKind.UI}.
	 */
	extensionKind: ExtensionKind

	/**
	 * The public API exported by this extension (return value of `activate`).
	 * It is an invalid action to access this field before this extension has been activated.
	 */
	readonly exports: T

	/**
	 * Activates this extension and returns its public API.
	 *
	 * @returns A promise that will resolve when this extension has been activated.
	 */
	activate(): Thenable<T>
}
