/**
 * Welcome view component
 * Shows an interactive prompt when user starts cline without a command
 * Supports file mentions with @
 */

import { Box, Text, useInput } from "ink"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { StateManager } from "@/core/storage/StateManager"
import {
	checkAndWarnRipgrepMissing,
	extractMentionQuery,
	type FileSearchResult,
	getRipgrepInstallInstructions,
	insertMention,
	searchWorkspaceFiles,
} from "../utils/file-search"
import { parseImagesFromInput } from "../utils/parser"
import { AccountInfoView } from "./AccountInfoView"
import { FileMentionMenu } from "./FileMentionMenu"

interface WelcomeViewProps {
	onSubmit: (prompt: string, imagePaths: string[]) => void
	onExit?: () => void
	controller?: any
}

const SEPARATOR = "─".repeat(60)
const SEARCH_DEBOUNCE_MS = 150
const RIPGREP_WARNING_DURATION_MS = 5000
const MAX_SEARCH_RESULTS = 15

export const WelcomeView: React.FC<WelcomeViewProps> = ({ onSubmit, onExit, controller }) => {
	const [textInput, setTextInput] = useState("")
	const [fileResults, setFileResults] = useState<FileSearchResult[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isSearching, setIsSearching] = useState(false)
	const [showRipgrepWarning, setShowRipgrepWarning] = useState(false)

	const mode = useMemo(() => {
		const stateManager = StateManager.get()
		return stateManager.getGlobalSettingsKey("mode")
	}, [])

	const refs = useRef({
		searchTimeout: null as NodeJS.Timeout | null,
		lastQuery: "",
		hasCheckedRipgrep: false,
	})

	const { prompt, imagePaths } = parseImagesFromInput(textInput)

	const mentionInfo = useMemo(() => extractMentionQuery(textInput), [textInput])

	const workspacePath = useMemo(() => {
		try {
			const root = controller?.getWorkspaceManagerSync?.()?.getPrimaryRoot?.()
			if (root?.path) {
				return root.path
			}
		} catch {
			// Fallback to cwd
		}
		return process.cwd()
	}, [controller])

	// Search for files when in mention mode
	useEffect(() => {
		const { current: r } = refs

		if (!mentionInfo.inMentionMode) {
			setFileResults([])
			setSelectedIndex(0)
			if (r.searchTimeout) {
				clearTimeout(r.searchTimeout)
				r.searchTimeout = null
			}
			return
		}

		// Check for ripgrep on first mention trigger
		if (!r.hasCheckedRipgrep) {
			r.hasCheckedRipgrep = true
			if (checkAndWarnRipgrepMissing()) {
				setShowRipgrepWarning(true)
				setTimeout(() => setShowRipgrepWarning(false), RIPGREP_WARNING_DURATION_MS)
			}
		}

		const { query } = mentionInfo
		if (query === r.lastQuery) {
			return
		}
		r.lastQuery = query

		if (r.searchTimeout) {
			clearTimeout(r.searchTimeout)
		}
		setIsSearching(true)

		r.searchTimeout = setTimeout(async () => {
			try {
				const results = await searchWorkspaceFiles(query, workspacePath, MAX_SEARCH_RESULTS)
				setFileResults(results)
				setSelectedIndex(0)
			} catch {
				setFileResults([])
			} finally {
				setIsSearching(false)
			}
		}, SEARCH_DEBOUNCE_MS)

		return () => {
			if (r.searchTimeout) {
				clearTimeout(r.searchTimeout)
			}
		}
	}, [mentionInfo.inMentionMode, mentionInfo.query, workspacePath])

	useInput((input, key) => {
		const inMenu = mentionInfo.inMentionMode && fileResults.length > 0

		// Menu navigation
		if (inMenu) {
			if (key.upArrow) {
				setSelectedIndex((i) => (i > 0 ? i - 1 : fileResults.length - 1))
				return
			}
			if (key.downArrow) {
				setSelectedIndex((i) => (i < fileResults.length - 1 ? i + 1 : 0))
				return
			}
			if (key.tab || key.return) {
				const file = fileResults[selectedIndex]
				if (file) {
					setTextInput(insertMention(textInput, mentionInfo.atIndex, file.path))
					setFileResults([])
					setSelectedIndex(0)
				}
				return
			}
			if (key.escape) {
				setFileResults([])
				setSelectedIndex(0)
				return
			}
		}

		// Normal input handling
		if (key.return && !mentionInfo.inMentionMode) {
			if (prompt.trim() || imagePaths.length > 0) {
				onSubmit(prompt.trim(), imagePaths)
			}
			return
		}
		if (key.escape && !mentionInfo.inMentionMode) {
			onExit?.()
			return
		}
		if (key.backspace || key.delete) {
			setTextInput((prev) => prev.slice(0, -1))
			return
		}
		if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.tab) {
			setTextInput((prev) => prev + input)
		}
	})

	return (
		<Box flexDirection="column">
			<Text bold color="cyan">
				✻ Welcome to Cline
			</Text>
			<Text color="gray">{SEPARATOR}</Text>
			{controller && (
				<Box marginTop={1}>
					<AccountInfoView controller={controller} />
				</Box>
			)}
			{showRipgrepWarning && (
				<Box
					borderColor="yellow"
					borderStyle="single"
					flexDirection="column"
					marginTop={1}
					paddingLeft={1}
					paddingRight={1}>
					<Text color="yellow">⚠ ripgrep (rg) not found - file search will be slower</Text>
					<Text color="gray">Install with: {getRipgrepInstallInstructions()}</Text>
				</Box>
			)}
			<Text> </Text>
			<Box flexDirection="column" marginTop={1}>
				<Text color="cyan">┃ [{mode} mode] What would you like Cline to help you with?</Text>

				<Box>
					<Text color="green">&gt; </Text>
					<Text>{textInput}</Text>
					<Text color="gray">▌</Text>
				</Box>
				{imagePaths.length > 0 && (
					<Box flexDirection="column" marginTop={1}>
						<Text color="magenta">📎 Images: {imagePaths.length}</Text>
						{imagePaths.map((p, i) => (
							<Text color="gray" dimColor key={i}>
								{p}
							</Text>
						))}
					</Box>
				)}
			</Box>
			<Text> </Text>

			{/* File mention menu - show above the input */}
			{mentionInfo.inMentionMode && (
				<FileMentionMenu
					isLoading={isSearching}
					query={mentionInfo.query}
					results={fileResults}
					selectedIndex={selectedIndex}
				/>
			)}

			<Text color="gray" dimColor>
				(Type your task and press Enter to Submit.)
			</Text>
			<Text color="gray" dimColor>
				(Type @ to mention files, add images with @/path/to/image.png)
			</Text>
		</Box>
	)
}
