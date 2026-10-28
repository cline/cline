import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";

const MAX_TEXT_FILE_BYTES = 128 * 1024;

class TextFileValidationError extends Error {}

/** Validate the original bytes before native string conversion can truncate them. */
export function decodeTextFile(bytes: Uint8Array): string {
	if (bytes.byteLength > MAX_TEXT_FILE_BYTES) {
		throw new TextFileValidationError(
			"Choose a text file smaller than 128 KB.",
		);
	}
	if (bytes.includes(0)) {
		throw new TextFileValidationError("Choose a UTF-8 text file.");
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new TextFileValidationError("Choose a UTF-8 text file.");
	}
}

export function appendTextFile(
	draft: string,
	name: string,
	content: string,
): string {
	if (content.includes("\0")) {
		throw new TextFileValidationError("Choose a UTF-8 text file.");
	}
	if (new TextEncoder().encode(content).length > MAX_TEXT_FILE_BYTES) {
		throw new TextFileValidationError(
			"Choose a text file smaller than 128 KB.",
		);
	}
	if (!content.trim()) throw new TextFileValidationError("This file is empty.");
	return `${draft}${draft ? "\n\n" : ""}Attached file ${JSON.stringify(name)}:\n${content}`;
}

/** The Hub accepts machine-side paths, so phone files are inserted as editable text. */
export function useTextFileAttachment(
	draft: string,
	onChange: (text: string) => void,
) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const current = useRef({ draft, onChange });
	current.current = { draft, onChange };
	const mounted = useRef(true);
	const picking = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const pick = async () => {
		if (picking.current) return;
		picking.current = true;
		setBusy(true);
		setError(undefined);
		try {
			const result = await DocumentPicker.getDocumentAsync({
				type: [
					"text/*",
					"application/json",
					"application/xml",
					"application/javascript",
				],
				copyToCacheDirectory: true,
				multiple: false,
			});
			if (result.canceled) return;
			const asset = result.assets[0];
			if (!asset) return;
			const file = new File(asset.uri);
			try {
				if (!mounted.current) return;
				if (file.size > MAX_TEXT_FILE_BYTES)
					throw new TextFileValidationError(
						"Choose a text file smaller than 128 KB.",
					);
				const content = decodeTextFile(await file.bytes());
				if (mounted.current)
					current.current.onChange(
						appendTextFile(current.current.draft, asset.name, content),
					);
			} finally {
				// DocumentPicker copied this file into our cache; the original remains untouched.
				try {
					file.delete();
				} catch {
					/* Cache cleanup can be retried by the OS. */
				}
			}
		} catch (cause) {
			if (mounted.current)
				setError(
					cause instanceof TextFileValidationError
						? cause.message
						: "Couldn't read this file. Choose a UTF-8 text file and try again.",
				);
		} finally {
			picking.current = false;
			if (mounted.current) setBusy(false);
		}
	};
	return { pick, busy, error };
}
