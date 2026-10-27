import {
	createMediaBudgetState,
	type GeneratedMedia,
	validateAndReserveBase64Media,
} from "@cline/shared";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import { View } from "react-native";
import { Button, Text } from "@/ui";

/** Files are shared as bytes, never evaluated in a webview. */
export async function shareGeneratedFile(media: GeneratedMedia): Promise<void> {
	if (media.source.type !== "base64")
		throw new Error("This file is not available for sharing yet.");
	const validated = validateAndReserveBase64Media(
		media.source.data,
		{ maxTotalMediaBytes: 8 * 1024 * 1024 },
		createMediaBudgetState(),
	);
	if (!validated.ok)
		throw new Error(
			"This file is invalid or exceeds the 8 MB encoded attachment limit.",
		);
	if (!(await Sharing.isAvailableAsync()))
		throw new Error("File sharing is not available on this device.");
	const name =
		(media.name?.split(/[\\/]/).at(-1) || "generated-file")
			.replace(/[^\p{L}\p{N}._ -]/gu, "_")
			.replace(/^\.+/, "")
			.slice(0, 120) || "generated-file";
	const cache = new Directory(Paths.cache, "shared-generated-files");
	cache.create({ idempotent: true, intermediates: true });
	let bytes = 0;
	for (const entry of cache.list()) {
		if (!(entry instanceof File)) continue;
		const timestamp = Number(entry.name.split("-")[0]);
		if (timestamp > 0 && Date.now() - timestamp > 24 * 60 * 60 * 1000)
			entry.delete();
		else bytes += entry.size;
	}
	if (bytes + validated.decodedBytes > 64 * 1024 * 1024)
		throw new Error("The file sharing cache is full. Try again later.");
	const file = new File(
		cache,
		`${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`,
	);
	try {
		file.create();
		file.write(validated.base64, { encoding: "base64" });
		await Sharing.shareAsync(file.uri, {
			dialogTitle: media.name ?? "Save or share generated file",
			mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(media.mediaType)
				? media.mediaType
				: "application/octet-stream",
		});
	} catch (error) {
		try {
			if (file.exists) file.delete();
		} catch {
			/* OS cache cleanup. */
		}
		throw error;
	}
	// Android's chooser can finish before its recipient reads the FileProvider
	// URI. Retain successful shares for a day; later shares prune this bounded cache.
}

export function GeneratedFile({ media }: { media: GeneratedMedia }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const inFlight = useRef(false);
	return (
		<View style={{ gap: 8, padding: 12 }}>
			<Text weight="500">{media.name ?? "Generated file"}</Text>
			{media.source.type === "base64" ? (
				<Button
					label={busy ? "Opening file…" : "Save or share file"}
					disabled={busy}
					variant="outline"
					onPress={() => {
						if (inFlight.current) return;
						inFlight.current = true;
						setBusy(true);
						setError(undefined);
						void shareGeneratedFile(media)
							.catch((cause) => {
								setError(
									cause instanceof Error
										? cause.message
										: "Could not share this file. Try again.",
								);
							})
							.finally(() => {
								inFlight.current = false;
								setBusy(false);
							});
					}}
				/>
			) : (
				<Text tone="muted">This file is not available for sharing yet.</Text>
			)}
			{error ? (
				<Text tone="danger" accessibilityRole="alert">
					{error}
				</Text>
			) : null}
		</View>
	);
}
