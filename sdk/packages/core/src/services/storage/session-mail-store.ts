export type { ListInboxOptions, SessionMailStore } from "../../types/storage";
export {
	FileSessionMailStore,
	type FileSessionMailStoreOptions,
} from "./file-session-mail-store";
export {
	SqliteSessionMailStore,
	type SqliteSessionMailStoreOptions,
} from "./sqlite-session-mail-store";

import type { SessionMailStore } from "../../types/storage";
import { FileSessionMailStore } from "./file-session-mail-store";
import {
	SqliteSessionMailStore,
	type SqliteSessionMailStoreOptions,
} from "./sqlite-session-mail-store";

/**
 * Prefers SQLite so concurrent sessions get real write isolation, and falls
 * back to the append-only file log when the native SQLite binding is
 * unavailable. Mirrors `createLocalTeamStore`.
 */
export function createLocalSessionMailStore(
	options: SqliteSessionMailStoreOptions = {},
): SessionMailStore {
	try {
		const store = new SqliteSessionMailStore(options);
		store.init();
		return store;
	} catch {
		const store = new FileSessionMailStore({ mailDir: options.mailDir });
		store.init();
		return store;
	}
}
