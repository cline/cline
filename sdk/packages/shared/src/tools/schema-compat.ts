export interface ToolInputSchemaCompatibilityIssue {
	path: string;
	message: string;
	value?: string;
}

export interface ToolInputSchemaCompatibilityContext {
	extensionName?: string;
	toolName?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function formatPathSegment(key: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
		? `.${key}`
		: `[${JSON.stringify(key)}]`;
}

function isEscaped(input: string, index: number): boolean {
	let backslashes = 0;
	for (let i = index - 1; i >= 0 && input[i] === "\\"; i--) {
		backslashes++;
	}
	return backslashes % 2 === 1;
}

function containsRegexLookaround(pattern: string): boolean {
	for (let index = 0; index < pattern.length - 2; index++) {
		if (
			pattern[index] !== "(" ||
			pattern[index + 1] !== "?" ||
			isEscaped(pattern, index)
		) {
			continue;
		}

		const marker = pattern[index + 2];
		if (marker === "=" || marker === "!") {
			return true;
		}
		if (
			marker === "<" &&
			(pattern[index + 3] === "=" || pattern[index + 3] === "!")
		) {
			return true;
		}
	}
	return false;
}

export function collectToolInputSchemaCompatibilityIssues(
	schema: unknown,
): ToolInputSchemaCompatibilityIssue[] {
	const issues: ToolInputSchemaCompatibilityIssue[] = [];

	function visit(value: unknown, path: string): void {
		if (Array.isArray(value)) {
			value.forEach((entry, index) => {
				visit(entry, `${path}[${index}]`);
			});
			return;
		}
		if (!isObject(value)) {
			return;
		}

		for (const [key, entry] of Object.entries(value)) {
			const entryPath = `${path}${formatPathSegment(key)}`;
			if (
				key === "pattern" &&
				typeof entry === "string" &&
				containsRegexLookaround(entry)
			) {
				issues.push({
					path: entryPath,
					message:
						"regex lookaround is not supported in portable tool JSON schemas",
					value: entry,
				});
				continue;
			}
			visit(entry, entryPath);
		}
	}

	visit(schema, "$");
	return issues;
}

export function assertToolInputSchemaPortable(
	schema: unknown,
	context: ToolInputSchemaCompatibilityContext = {},
): void {
	const issues = collectToolInputSchemaCompatibilityIssues(schema);
	if (issues.length === 0) {
		return;
	}

	const subject =
		context.toolName && context.extensionName
			? `Tool inputSchema for "${context.extensionName}.${context.toolName}"`
			: context.toolName
				? `Tool inputSchema for "${context.toolName}"`
				: "Tool inputSchema";
	const details = issues
		.map((issue) => {
			const value = issue.value ? ` (${JSON.stringify(issue.value)})` : "";
			return `${issue.path}: ${issue.message}${value}`;
		})
		.join("; ");
	throw new Error(
		`${subject} contains provider-incompatible JSON Schema: ${details}. ` +
			"Move this validation into the tool execute function or use a simpler provider-compatible pattern.",
	);
}
