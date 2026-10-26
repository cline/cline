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
	/** Detaches and returns those of `wanted` still attached; files added since stay. */
	const takeFiles = useCallback(
		(wanted: readonly File[]): File[] => {
			const taken = currentFiles.current.filter((file) =>
				wanted.includes(file),
			);
			updateFiles((current) => current.filter((file) => !taken.includes(file)));
			return taken;
		},
		[updateFiles],
	);
	return [files, updateFiles, takeFiles] as const;
}
