import type * as LlmsProviders from "@clinebot/llms";

export async function buildInitialUserContent(
	userMessage: string,
	userImages?: string[],
	userFiles?: string[],
	userFileContentLoader?: (path: string) => Promise<string>,
): Promise<string | LlmsProviders.ContentBlock[]> {
	const imageBlocks = buildImageBlocks(userImages);
	const fileTextBlocks = await buildUserFileContentBlock(
		userFiles,
		userFileContentLoader,
	);

	if (imageBlocks.length === 0 && !fileTextBlocks) {
		return userMessage;
	}

	const content: LlmsProviders.ContentBlock[] = [
		{
			type: "text",
			text: userMessage,
		},
		...imageBlocks,
	];
	if (fileTextBlocks) {
		content.push(...fileTextBlocks);
	}
	return content;
}

function buildImageBlocks(userImages?: string[]): LlmsProviders.ImageContent[] {
	if (!userImages || userImages.length === 0) {
		return [];
	}

	const blocks: LlmsProviders.ImageContent[] = [];
	for (const image of userImages) {
		const block = parseDataUrlImage(image);
		if (block) {
			blocks.push(block);
		}
	}
	return blocks;
}

function parseDataUrlImage(
	image: string,
): LlmsProviders.ImageContent | undefined {
	const value = image.trim();
	if (!value) {
		return undefined;
	}

	const dataUrlMatch = value.match(/^data:([^;,]+);base64,(.+)$/);
	if (dataUrlMatch) {
		const mediaType = dataUrlMatch[1];
		const data = dataUrlMatch[2];
		if (!mediaType || !data) {
			return undefined;
		}
		return {
			type: "image",
			mediaType,
			data,
		};
	}

	// Fallback: treat as plain base64 payload.
	return {
		type: "image",
		mediaType: "image/png",
		data: value,
	};
}

async function buildUserFileContentBlock(
	userFiles?: string[],
	userFileContentLoader?: (path: string) => Promise<string>,
): Promise<LlmsProviders.FileContent[] | undefined> {
	if (!userFiles || userFiles.length === 0) {
		return undefined;
	}

	const loader =
		userFileContentLoader ??
		(async () => {
			throw new Error(
				"File loading is not configured in this runtime. Provide userFileContentLoader to enable userFiles support.",
			);
		});

	const contents = await Promise.all(
		userFiles.map(async (filePath) => {
			const normalizedPath = filePath.replace(/\\/g, "/");
			try {
				const content = await loader(filePath);
				return {
					type: "file",
					path: normalizedPath,
					content,
				} satisfies LlmsProviders.FileContent;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					type: "file",
					path: normalizedPath,
					content: `Error fetching content: ${message}`,
				} satisfies LlmsProviders.FileContent;
			}
		}),
	);

	if (contents.length === 0) {
		return undefined;
	}
	return contents;
}
