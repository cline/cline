import { useCallback, useRef, useState } from "react";
import { searchWorkspaceFilesForMention } from "../../tui/interactive-welcome";
import {
	formatSlashCommandAutocompleteValue,
	type SlashCommandRegistryEntry,
} from "../commands/slash-command-registry";
import { COMPLETION_DEBOUNCE_MS, MAX_COMPLETION_RESULTS } from "../types";

export type AutocompleteMode = false | "@" | "/";

interface MentionQueryInfo {
	inMentionMode: boolean;
	query: string;
	atIndex: number;
}

interface SlashQueryInfo {
	inSlashMode: boolean;
	query: string;
	slashIndex: number;
}

export function extractMentionQuery(text: string): MentionQueryInfo {
	const atIndex = text.lastIndexOf("@");
	if (atIndex === -1 || (atIndex > 0 && !/\s/.test(text[atIndex - 1] ?? ""))) {
		return { inMentionMode: false, query: "", atIndex: -1 };
	}
	const query = text.slice(atIndex + 1);
	if (query.includes(" ")) {
		return { inMentionMode: false, query: "", atIndex: -1 };
	}
	return { inMentionMode: true, query, atIndex };
}

export function extractSlashQuery(text: string): SlashQueryInfo {
	const slashIndex = text.lastIndexOf("/");
	if (slashIndex === -1) {
		return { inSlashMode: false, query: "", slashIndex: -1 };
	}
	if (slashIndex > 0 && !/\s/.test(text[slashIndex - 1] ?? "")) {
		return { inSlashMode: false, query: "", slashIndex: -1 };
	}
	const query = text.slice(slashIndex + 1);
	if (/\s/.test(query)) {
		return { inSlashMode: false, query: "", slashIndex: -1 };
	}
	const firstSlashCommandRegex = /(^|\s)\/[a-zA-Z0-9_.-]+\s/;
	const textBeforeCurrentSlash = text.slice(0, slashIndex);
	if (firstSlashCommandRegex.test(textBeforeCurrentSlash)) {
		return { inSlashMode: false, query: "", slashIndex: -1 };
	}
	return { inSlashMode: true, query, slashIndex };
}

export function insertMention(
	text: string,
	atIndex: number,
	filePath: string,
): string {
	const endIndex = text.indexOf(" ", atIndex);
	const end = endIndex === -1 ? text.length : endIndex;
	const normalizedPath =
		filePath.startsWith("/") ||
		filePath.startsWith("~/") ||
		filePath.startsWith("./") ||
		filePath.startsWith("../")
			? filePath
			: `./${filePath}`;
	const mention = normalizedPath.includes(" ")
		? `@"${normalizedPath}"`
		: `@${normalizedPath}`;
	return `${text.slice(0, atIndex)}${mention} ${text.slice(end).trimStart()}`;
}

export function formatMentionAutocompleteValue(filePath: string): string {
	const normalizedPath =
		filePath.startsWith("/") ||
		filePath.startsWith("~/") ||
		filePath.startsWith("./") ||
		filePath.startsWith("../")
			? filePath
			: `./${filePath}`;
	const mention = normalizedPath.includes(" ")
		? `@"${normalizedPath}"`
		: `@${normalizedPath}`;
	return `${mention} `;
}

export function insertSlashCommand(
	text: string,
	slashIndex: number,
	commandName: string,
): string {
	return `${text.slice(0, slashIndex)}/${commandName} `;
}

export interface AutocompleteOption {
	display: string;
	value: string;
	description?: string;
	onSelect?: () => void;
	isHeader?: boolean;
	commandName?: string;
	commandExecution?: SlashCommandRegistryEntry["execution"];
	commandSource?: SlashCommandRegistryEntry["source"];
}

export interface AutocompleteState {
	mode: AutocompleteMode;
	filter: string;
	selected: number;
	filteredOptions: AutocompleteOption[];
	mentionResults: string[];
}

export function getFirstSelectableIndex(
	options: readonly AutocompleteOption[],
): number {
	const index = options.findIndex((option) => !option.isHeader);
	return index === -1 ? 0 : index;
}

export function useAutocomplete(opts: {
	workspaceRoot: string;
	systemCommands: SlashCommandRegistryEntry[];
	skillCommands: SlashCommandRegistryEntry[];
}) {
	const { workspaceRoot, systemCommands, skillCommands } = opts;

	const [mode, setMode] = useState<AutocompleteMode>(false);
	const [filter, setFilter] = useState("");
	const [selected, setSelected] = useState(0);
	const [mentionResults, setMentionResults] = useState<string[]>([]);

	const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
	const searchCounterRef = useRef(0);

	const systemOptions: AutocompleteOption[] = systemCommands.map((cmd) => ({
		display: `/${cmd.name}`,
		value: formatSlashCommandAutocompleteValue(cmd),
		description: cmd.description,
		commandName: cmd.name,
		commandExecution: cmd.execution,
		commandSource: cmd.source,
	}));

	const skillOptions: AutocompleteOption[] = skillCommands.map((cmd) => ({
		display: `/${cmd.name}`,
		value: formatSlashCommandAutocompleteValue(cmd),
		description: cmd.description,
		commandName: cmd.name,
		commandExecution: cmd.execution,
		commandSource: cmd.source,
	}));

	const getFilteredSlashOptions = useCallback(
		(query: string): AutocompleteOption[] => {
			const q = query.toLowerCase();
			const filterFn = (o: AutocompleteOption) => {
				if (!q) return true;
				const name = o.display.toLowerCase().slice(1);
				const desc = o.description?.toLowerCase() ?? "";
				return name.includes(q) || desc.includes(q);
			};
			const sortFn = (a: AutocompleteOption, b: AutocompleteOption) => {
				if (!q) return 0;
				const aName = a.display.toLowerCase().slice(1);
				const bName = b.display.toLowerCase().slice(1);
				const aNameStarts = aName.startsWith(q);
				const bNameStarts = bName.startsWith(q);
				if (aNameStarts && !bNameStarts) return -1;
				if (!aNameStarts && bNameStarts) return 1;
				const aNameIncludes = aName.includes(q);
				const bNameIncludes = bName.includes(q);
				if (aNameIncludes && !bNameIncludes) return -1;
				if (!aNameIncludes && bNameIncludes) return 1;
				return 0;
			};

			const filteredSystem = systemOptions.filter(filterFn).sort(sortFn);
			const filteredSkills = skillOptions.filter(filterFn).sort(sortFn);

			if (filteredSkills.length === 0) return filteredSystem;

			const result: AutocompleteOption[] = [...filteredSystem];
			result.push({
				display: "Skills",
				value: "",
				isHeader: true,
			});
			result.push(...filteredSkills);
			return result.slice(0, MAX_COMPLETION_RESULTS);
		},
		[systemOptions, skillOptions],
	);

	const getFilteredMentionOptions = useCallback(
		(query: string): AutocompleteOption[] => {
			const q = query.toLowerCase();
			let filtered = mentionResults;
			if (q) {
				filtered = mentionResults.filter((f) => f.toLowerCase().includes(q));
			}
			return filtered.slice(0, MAX_COMPLETION_RESULTS).map((f) => ({
				display: f,
				value: formatMentionAutocompleteValue(f),
			}));
		},
		[mentionResults],
	);

	const updateAutocomplete = useCallback(
		(text: string) => {
			const slash = extractSlashQuery(text);
			if (slash.inSlashMode) {
				setMode("/");
				setFilter(slash.query);
				setSelected(
					getFirstSelectableIndex(getFilteredSlashOptions(slash.query)),
				);
				return;
			}

			const mention = extractMentionQuery(text);
			if (mention.inMentionMode) {
				setMode("@");
				setFilter(mention.query);
				setSelected(0);

				if (searchTimerRef.current) {
					clearTimeout(searchTimerRef.current);
				}
				const counter = ++searchCounterRef.current;
				searchTimerRef.current = setTimeout(() => {
					searchWorkspaceFilesForMention({
						workspaceRoot,
						query: mention.query,
						limit: MAX_COMPLETION_RESULTS,
					})
						.then((results) => {
							if (counter === searchCounterRef.current) {
								setMentionResults(results);
							}
						})
						.catch(() => {});
				}, COMPLETION_DEBOUNCE_MS);
				return;
			}

			setMode(false);
			setFilter("");
		},
		[workspaceRoot, getFilteredSlashOptions],
	);

	const getFilteredOptions = useCallback((): AutocompleteOption[] => {
		if (mode === "/") return getFilteredSlashOptions(filter);
		if (mode === "@") return getFilteredMentionOptions(filter);
		return [];
	}, [mode, filter, getFilteredSlashOptions, getFilteredMentionOptions]);

	const close = useCallback(() => {
		setMode(false);
		setFilter("");
		setSelected(0);
	}, []);

	return {
		mode,
		filter,
		selected,
		setSelected,
		updateAutocomplete,
		getFilteredOptions,
		close,
		setMode,
	};
}
