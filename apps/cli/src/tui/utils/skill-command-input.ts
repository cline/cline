export interface LocalSlashCommandInvocation {
	text: string;
	cursorOffset: number;
	replaceRange?: {
		start: number;
		end: number;
	};
}

function clampOffset(offset: number, text: string): number {
	return Math.max(0, Math.min(offset, text.length));
}

function normalizeRange(
	range: LocalSlashCommandInvocation["replaceRange"],
	text: string,
): { start: number; end: number } | undefined {
	if (!range) return undefined;
	const start = clampOffset(Math.min(range.start, range.end), text);
	const end = clampOffset(Math.max(range.start, range.end), text);
	return start === end ? undefined : { start, end };
}

function normalizeCommandName(commandName: string): string {
	return commandName.trim().replace(/^\/+/, "");
}

function stripLeadingInlineWhitespace(text: string): string {
	return text.replace(/^[ \t]+/, "");
}

export function insertSelectedSkillCommand(input: {
	text: string;
	cursorOffset: number;
	commandName: string;
	replaceRange?: LocalSlashCommandInvocation["replaceRange"];
}): { text: string; cursorOffset: number } {
	const commandName = normalizeCommandName(input.commandName);
	const commandText = `/${commandName} `;
	const range = normalizeRange(input.replaceRange, input.text);

	if (range) {
		const before = input.text.slice(0, range.start);
		const after = stripLeadingInlineWhitespace(input.text.slice(range.end));
		const leadingSpace = before.length > 0 && !/\s$/.test(before) ? " " : "";
		const text = `${before}${leadingSpace}${commandText}${after}`;
		return {
			text,
			cursorOffset: before.length + leadingSpace.length + commandText.length,
		};
	}

	const cursorOffset = clampOffset(input.cursorOffset, input.text);
	const before = input.text.slice(0, cursorOffset);
	const after = stripLeadingInlineWhitespace(input.text.slice(cursorOffset));
	const leadingSpace = before.length > 0 && !/\s$/.test(before) ? " " : "";
	const text = `${before}${leadingSpace}${commandText}${after}`;

	return {
		text,
		cursorOffset: before.length + leadingSpace.length + commandText.length,
	};
}

export function removeLocalSlashCommandInvocation(
	invocation: LocalSlashCommandInvocation,
): { text: string; cursorOffset: number } {
	const range = normalizeRange(invocation.replaceRange, invocation.text);
	if (!range) {
		return {
			text: invocation.text,
			cursorOffset: clampOffset(invocation.cursorOffset, invocation.text),
		};
	}

	const before = invocation.text.slice(0, range.start);
	const after = invocation.text.slice(range.end);
	const joinedAfter =
		before.length > 0 && /\s$/.test(before)
			? stripLeadingInlineWhitespace(after)
			: after;
	const text = `${before}${joinedAfter}`;

	return {
		text,
		cursorOffset: clampOffset(range.start, text),
	};
}
