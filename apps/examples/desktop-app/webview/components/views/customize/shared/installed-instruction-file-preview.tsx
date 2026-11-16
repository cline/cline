"use client";

import { FileBrowser, FileBrowserContent } from "@cline/ui";
import { MemoizedMarkdown } from "@/components/ui/markdown";
import { desktopClient } from "@/lib/desktop-client";

export function InstalledInstructionFilePreview({
	path,
	instructions,
	type,
}: {
	path: string;
	instructions: string;
	type: "rule" | "workflow";
}) {
	const label = type === "rule" ? "Rule" : "Workflow";
	const filename = path.replaceAll("\\", "/").split("/").at(-1) ?? path;

	return (
		<FileBrowser
			aria-label={`${label} content`}
			files={[{ path: filename }]}
			filesLabel={`${label} files`}
			onSelect={() => undefined}
			selectedPath={filename}
		>
			<FileBrowserContent
				key={`${type}:${path}`}
				path={filename}
				actionPath={path}
				onOpenFileLocation={async (location) => {
					await desktopClient.invoke("reveal_path", { path: location });
				}}
				content={instructions}
				preview={
					<MemoizedMarkdown classNames="text-sm" content={instructions} />
				}
			/>
		</FileBrowser>
	);
}
