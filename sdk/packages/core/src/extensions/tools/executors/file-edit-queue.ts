const pendingEdits = new Map<string, Promise<void>>();

export function serializeFileEdits<T>(
	filePaths: readonly string[],
	edit: () => Promise<T>,
): Promise<T> {
	const keys = [
		...new Set(
			filePaths.map((filePath) =>
				process.platform === "win32" ? filePath.toLowerCase() : filePath,
			),
		),
	];
	const result = Promise.all(keys.map((key) => pendingEdits.get(key))).then(
		edit,
	);
	const completion = result.then(
		() => undefined,
		() => undefined,
	);
	for (const key of keys) pendingEdits.set(key, completion);
	void completion.then(() => {
		for (const key of keys) {
			if (pendingEdits.get(key) === completion) pendingEdits.delete(key);
		}
	});
	return result;
}
