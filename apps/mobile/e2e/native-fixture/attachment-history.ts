/** Scripted test runtime adaptation to the canonical persisted image/file block schema. */
export interface SubmittedAttachments {
	sessionId: string;
	prompt: string;
	userImages?: string[];
	userFiles?: string[];
}
export function attachmentMessages(
	messages: any[],
	inputs: SubmittedAttachments[],
): any[] {
	const result = messages.map((message) => ({ ...message }));
	let after = 0;
	for (const input of inputs) {
		if (!input.userImages?.length && !input.userFiles?.length) continue;
		const index = result.findIndex(
			(message, position) =>
				position >= after &&
				message.role === "user" &&
				(typeof message.content === "string"
					? message.content
					: Array.isArray(message.content)
						? message.content
								.filter((block: any) => block.type === "text")
								.map((block: any) => block.text)
								.join("\n")
						: "") === input.prompt,
		);
		if (index < 0) continue;
		after = index + 1;
		const message = result[index];
		if (
			Array.isArray(message.content) &&
			message.content.some(
				(block: any) => block.type === "image" || block.type === "file",
			)
		)
			continue;
		const blocks: any[] = [{ type: "text", text: input.prompt }];
		for (const image of input.userImages ?? []) {
			const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(image);
			blocks.push({
				type: "image",
				mediaType: match?.[1] ?? "image/png",
				data: match?.[2] ?? image,
			});
		}
		for (const file of input.userFiles ?? [])
			blocks.push({ type: "file", content: file });
		result[index] = { ...message, content: blocks };
	}
	return result;
}
