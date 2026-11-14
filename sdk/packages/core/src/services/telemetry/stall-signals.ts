/**
 * Stall signals ported from the offline (Python) stall detector, so the harness
 * can label runs live and send only the verdict, never the text.
 *
 * Python's `\w`/`\b` match letters in any script; JS's match ASCII only, even
 * with the `u` flag, so spots that meet non-ASCII words use `\p{L}` instead.
 */

export type StallBumpKind = "probe" | "nudge" | "greeting" | "none";
export type StallTextSignature =
	| "empty_turn"
	| "api_error"
	| "truncated_text"
	| "async_promise"
	| "intent_without_action"
	| "none";

const re = (source: string) => new RegExp(source, "iu");

// User reacting to a stall: "are you stuck?", "continue", "hello?"
const PROBE_RES = [
	String.raw`\b(?:are|r)\s+(?:you|u)\s+(?:still\s+)?(?:stuck|dead|there|alive|ok(?:ay)?|frozen|hung|hanging|working|running|awake|on it|done|finished|thinking|doing anything|responding|back)\b`,
	String.raw`\b(?:you|u)\s+(?:still\s+)?(?:stuck|dead|alive|frozen|hung)\b`,
	String.raw`\b(?:did|has|have)\s+(?:you|it|this|that|the\s+\w+)(?:\s+\w+)?\s+(?:finish(?:ed)?|complete[d]?|stop(?:ped)?|die[d]?|hang|hung|crash(?:ed)?|freeze|froze|get\s+stuck|time[d]?\s*out)\b`,
	String.raw`\b(?:is|was)\s+(?:it|this|that|the\s+\w+)\s+(?:still\s+)?(?:stuck|hung|frozen|running|done|finished|working)\b`,
	String.raw`\bwhy\s+(?:did|have|has)\s+(?:you|it)\s+stop(?:ped)?\b|\b(?:you|it)\s+(?:just\s+)?stopped\b`,
	String.raw`\b(?:seems?|appears?|looks?)\s+(?:to\s+be\s+|like\s+(?:you(?:'re| are)|it(?:'s| is))\s+)?(?:stuck|frozen|hung|dead)\b`,
	String.raw`\bwhat(?:'s|\s+is)?\s+(?:happening|going\s+on)\b|\bwhat\s+happened\b|\bany\s+(?:update|progress)\b|^\s*(?:status|update|progress)\s*\?+\s*$`,
	String.raw`\bprevious\s+(?:\w+\s+){0,4}(?:response|answer|reply|output)\s+(?:was|got)\s+(?:incomplete|cut\s+off|truncated|interrupted)|\bincomplete\s+or\s+timed\s+out\b`,
	String.raw`\byou\s+(?:got\s+)?cut\s+off\b(?!\s+by\s+my)|\b(?:your\s+)?(?:response|answer|reply)\s+(?:got\s+|was\s+)?cut\s+off\b(?!\s+by\s+my)`,
	String.raw`^(?:anyone\s+there|you\s+there|wake\s+up)\s*[?!.]*$`,
	String.raw`^[?？]+$|^\.{3,}$|^.{0,6}[?？]{3,}$`,
	String.raw`还在吗|在吗[?？]?$|怎么不动|你怎么停|怎么停了|止まった|固まった|フリーズ|멈췄|завис|застрял|bist\s+du\s+(?:noch\s+)?da`,
].map(re);
const BARE_STATE_RE = re(
	String.raw`\b(?:stuck|hung|hanging|frozen|unresponsive|not\s+responding|no\s+response)\b|卡住|卡了|没反应|不动了`,
);
const NUDGE_RE = re(
	String.raw`^(?:(?:ok(?:ay)?|k|so|well|please|pls|now|yes|yeah)[,.!]?\s+)*` +
		String.raw`(?:continue|contine|contiune|keep\s+going|keep\s+working|go\s+on|go\s+ahead|go|proceed|resume|carry\s+on|next|finish(?:\s+it|\s+up)?|do\s+it|try\s+again|retry|again|` +
		String.raw`继续|繼續|続けて|계속|продолжа\p{L}*|дальше|давай|contin[uú]a|sigue|weiter|mach\s+weiter|continuez)` +
		String.raw`(?:(?![\p{L}\p{N}_])|(?<=[぀-ヿ一-鿿]))[\s\p{L}\p{N}_,.!?()'’-]{0,40}$`,
);
const RESUME_REQUEST_RE = re(
	String.raw`\b(?:pick\s+(?:it\s+)?(?:back\s+)?up|continue|carry\s+on|resume|keep\s+going)\s+(?:from\s+)?where\s+(?:you|we)\s+(?:left\s+off|stopped|were)\b|\bwhere\s+were\s+we\b`,
);
const GREETING_RE = re(
	String.raw`^(?:hello+|hi+|hey+|ping|yo|你好|在吗)\s*[?？!.]*$`,
);

// Final assistant turn that looks stalled: cut off, an error, or a promise not kept.
const API_ERROR_TEXT_RE = re(
	String.raw`^\s*(?:API error|API Request Failed|Error:\s*(?:Request|Stream|Connection))|stream-first-event-timeout|Request timed out|socket hang up|ECONNRESET|overloaded_error|upstream connect error|Provider returned error|terminated due to timeout`,
);
const TERMINAL_RE = re(
	String.raw`(?:[.!?:;)\]}"'\x60*>|_~。！？：）」』…]|[←-⯿\u{1F000}-\u{1FAFF}☀-➿️])\s*$`,
);
const LIST_TAIL_RE = re(String.raw`\n\s*(?:[-*•]|\d+[.)])\s+\S[^\n]*$`);
const ASYNC_PROMISE_RE = re(
	String.raw`\b(?:will|I'll|I\s+will)\s+(?:ping|notify|report|update|let\s+you\s+know|check\s+back|get\s+back)\b[^\n]{0,80}\b(?:when|once|after|as\s+soon\s+as)\b|\b(?:wait(?:ing)?\s+for\s+(?:it|the\s+\w+)\s+to\s+(?:finish|complete|land))\b`,
);
const INTENT_RE = re(
	String.raw`(?:^|[\n.!:]\s*)(?:now\s+|next[,:]?\s+|then\s+|first[,:]?\s+|ok(?:ay)?[,.]\s+|great[,.!]\s+)?(?:let\s+me|let's|i'll|i\s+will|i'm\s+going\s+to|i\s+am\s+going\s+to|i'm\s+now|going\s+to|launching|starting|running|proceeding|continuing|moving\s+on|time\s+to)\b[^\n]{0,240}[.:…]?\s*$`,
);
const ASKS_USER_RE = re(
	String.raw`\?\s*$|\b(?:want\s+me\s+to|should\s+i|shall\s+i|would\s+you\s+like|do\s+you\s+want|let\s+me\s+know|approve|confirm|which\s+(?:option|one|approach)|ready\s+to\s+proceed|when\s+you(?:'re|\s+are)\s+ready|ping\s+me|once\s+you)\b`,
);

export function classifyBumpText(prompt: string): StallBumpKind {
	const text = prompt.trim();
	const length = Array.from(text).length;
	if (!text || length > 200) return "none";
	if (PROBE_RES.some((pattern) => pattern.test(text))) return "probe";
	if (length <= 40 && BARE_STATE_RE.test(text)) return "probe";
	if (length <= 80 && NUDGE_RE.test(text)) return "nudge";
	if (RESUME_REQUEST_RE.test(text)) return "nudge";
	if (GREETING_RE.test(text)) return "greeting";
	return "none";
}

/** Signature of a run's final text-only assistant turn. */
export function classifyFinalTurnText(rawText: string): StallTextSignature {
	const text = rawText.trimEnd();
	if (!text) return "empty_turn";
	if (text.length < 600 && API_ERROR_TEXT_RE.test(text)) return "api_error";
	if ((text.split("```").length - 1) % 2 === 1) return "truncated_text";
	if (!TERMINAL_RE.test(text) && !LIST_TAIL_RE.test(text))
		return "truncated_text";
	const lastPara = text.slice(text.lastIndexOf("\n\n") + 1);
	if (ASYNC_PROMISE_RE.test(lastPara)) return "async_promise";
	if (INTENT_RE.test(lastPara) && !ASKS_USER_RE.test(lastPara.slice(-300)))
		return "intent_without_action";
	return "none";
}
