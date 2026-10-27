/** Presentation only: keep the exact catalog ID for selection, search and details. */
export function modelDisplayName(
	modelId?: string,
	catalogName?: string,
): string {
	const id = modelId?.trim() ?? "";
	const name = catalogName?.trim();
	// Human-authored catalog names are authoritative. An ID repeated in `name`
	// (or a lowercase routing slug) is not a useful display name.
	if (
		name &&
		name !== id &&
		!isRoutingId(name) &&
		!/^[a-z0-9._:/-]+$/.test(name)
	)
		return name;
	if (name && name !== id && /^[A-Za-z][A-Za-z0-9 ]*$/.test(name)) return name;
	const slug =
		(name && !isRoutingId(name) ? name : id)
			.replace(/^(?:cline-cloud|cline-pass|cline-paid|cline-free|cline)\//, "")
			.split("/")
			.at(-1) ?? "";
	if (!slug || slug === "default") return id ? "Cline default" : "Choose model";
	if (isRoutingId(slug)) {
		// Recognize a family only when the routing ID names it explicitly. Do not
		// invent a model/version from unrelated rollout numbers or dates.
		const claude = slug.match(/(?:^|-)(sonnet|opus|haiku)(\d)(\d)(?:-|$)/i);
		if (claude) return `Claude ${title(claude[1])} ${claude[2]}.${claude[3]}`;
		const gpt = slug.match(/(?:^|-)gpt(\d)(\d)(sol|terra|astra|luna)?(?:-|$)/i);
		if (gpt)
			return `GPT-${gpt[1]}.${gpt[2]}${gpt[3] ? ` ${title(gpt[3])}` : ""}`;
		return "Custom model";
	}
	const readable = slug
		.replace(/^(claude-)?(sonnet|opus|haiku)-/i, "claude-$2-")
		.replace(
			/^(claude-(?:sonnet|opus|haiku))-([0-9]+)-([0-9]+)(?=-|$)/i,
			"$1-$2.$3",
		)
		.replace(/[_-]+/g, " ")
		.split(/\s+/)
		.map(
			(word) =>
				({
					gpt: "GPT",
					glm: "GLM",
					deepseek: "DeepSeek",
					openai: "OpenAI",
					mimo: "MiMo",
					qwen: "Qwen",
					ai: "AI",
					vl: "VL",
					llm: "LLM",
				})[word.toLowerCase()] ??
				(/^v\d/i.test(word) ? `V${word.slice(1)}` : title(word)),
		)
		.join(" ");
	return readable || "Custom model";
}

function isRoutingId(value: string): boolean {
	return (
		/^cline-(?:new\d*|mistral|route|internal|experimental)-/i.test(value) ||
		/(?:^|-)\d{8}(?:-|$)/.test(value)
	);
}

function title(value: string): string {
	return value ? value[0].toUpperCase() + value.slice(1) : value;
}
