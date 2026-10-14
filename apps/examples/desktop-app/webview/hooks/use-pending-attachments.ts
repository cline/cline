import { type SetStateAction, useCallback, useRef, useState } from "react";

export function usePendingAttachments() {
	const [files, setFiles] = useState<File[]>([]);
	const currentFiles = useRef(files);
	// Resolve edits synchronously so stale send callbacks merge the latest draft.
	const updateFiles = useCallback((update: SetStateAction<File[]>) => {
		const next =
			typeof update === "function" ? update(currentFiles.current) : update;
		currentFiles.current = next;
		setFiles(next);
	}, []);
	return [files, updateFiles] as const;
}
