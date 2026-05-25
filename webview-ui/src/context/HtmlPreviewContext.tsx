import { EmptyRequest } from "@shared/proto/cline/common"
import type { HtmlPreviewItem } from "@shared/proto/cline/html_preview"
import { RemoveHtmlPreviewItemRequest } from "@shared/proto/cline/html_preview"
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { HtmlPreviewServiceClient } from "../services/grpc-client"
import { useExtensionState } from "./ExtensionStateContext"

/**
 * HtmlPreviewContext — webview-side state for the AI-Hydro HTML Preview panel.
 *
 * The contract with the extension (post-redesign):
 *   • `HtmlPreviewItem.webviewUri` is the URL the iframe should load
 *     (produced by `webview.asWebviewUri()` on the extension side).
 *   • `htmlContent` carries inline HTML when the artifact fits the size cap
 *     (preferred `srcdoc` render path); otherwise the webview falls back to
 *     `webviewUri`.
 *   • Rendering profile (scripts on/off) is chosen on the extension via
 *     `detectMode()` — the UI exposes a single "Preview" experience.
 */
/**
 * Module manifest payload (matches the `application/vnd.aihydro.module+json`
 * block authors embed at the top of a module). All fields are optional from
 * the panel's perspective — it just surfaces whatever is present.
 */
export interface AiHydroModuleManifest {
	id?: string
	title?: string
	version?: string
	authors?: Array<{ name?: string; affiliation?: string; orcid?: string }>
	license?: string
	topic?: string
	level?: "intro" | "intermediate" | "advanced" | string
	estimated_minutes?: number
	requires?: { executable?: boolean; python?: string[] }
	citation?: { text?: string; doi?: string }
	thumbnail?: string
	ai_hydro_preview_min_version?: string
	[k: string]: unknown
}

interface HtmlPreviewContextType {
	items: HtmlPreviewItem[]
	activeItemId: string | null
	setActiveItemId: (id: string | null) => void
	refreshItems: () => Promise<void>
	removeItem: (id: string) => Promise<void>
	clearAllItems: () => Promise<void>
	addItemFromContent: (title: string, htmlContent: string, filePath?: string) => Promise<void>
	loadWorkspaceFile: (filePath: string, title: string) => Promise<void>
	manifestsById: Record<string, AiHydroModuleManifest>
	setManifest: (itemId: string, manifest: AiHydroModuleManifest) => void
}

const HtmlPreviewContext = createContext<HtmlPreviewContextType>({
	items: [],
	activeItemId: null,
	setActiveItemId: () => {},
	refreshItems: async () => {},
	removeItem: async () => {},
	clearAllItems: async () => {},
	addItemFromContent: async () => {},
	loadWorkspaceFile: async () => {},
	manifestsById: {},
	setManifest: () => {},
})

export const HtmlPreviewContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [items, setItems] = useState<HtmlPreviewItem[]>([])
	const [activeItemId, setActiveItemId] = useState<string | null>(null)
	const [manifestsById, setManifestsById] = useState<Record<string, AiHydroModuleManifest>>({})
	const setManifest = useCallback((itemId: string, manifest: AiHydroModuleManifest) => {
		setManifestsById((prev) => ({ ...prev, [itemId]: manifest }))
	}, [])
	const activeItemIdRef = useRef(activeItemId)
	const lastVersionRef = useRef<number>(-1)
	const extensionState = useExtensionState()

	useEffect(() => {
		activeItemIdRef.current = activeItemId
	}, [activeItemId])

	const refreshItems = useCallback(async () => {
		try {
			const response = await HtmlPreviewServiceClient.getHtmlPreviewState(EmptyRequest.create())
			setItems(response.items)
			if (response.items.length > 0 && !activeItemIdRef.current) {
				setActiveItemId(response.items[response.items.length - 1].id)
			}
		} catch (error) {
			console.error("[HtmlPreviewContext] Failed to fetch preview state:", error)
		}
	}, [])

	const removeItem = useCallback(async (id: string) => {
		let nextItems: HtmlPreviewItem[] = []
		setItems((prev) => {
			nextItems = prev.filter((i) => i.id !== id)
			return nextItems
		})
		setManifestsById((prev) => {
			if (!(id in prev)) return prev
			const next = { ...prev }
			delete next[id]
			return next
		})
		if (activeItemIdRef.current === id) {
			setActiveItemId(nextItems.length > 0 ? nextItems[nextItems.length - 1].id : null)
		}
		try {
			await HtmlPreviewServiceClient.removeHtmlPreviewItem(RemoveHtmlPreviewItemRequest.create({ id }))
		} catch (error) {
			console.error("[HtmlPreviewContext] Failed to remove preview item:", error)
		}
	}, [])

	// React to htmlPreviewVersion changes from ExtensionState — this is the
	// reliable signal that the controller mutated HTML previews.
	useEffect(() => {
		const version = extensionState.htmlPreviewVersion ?? 0
		if (version > 0 && version !== lastVersionRef.current) {
			lastVersionRef.current = version
			refreshItems()
		}
	}, [extensionState.htmlPreviewVersion, refreshItems])

	useEffect(() => {
		// Initial pull + streaming subscription.
		refreshItems()

		const handleClearEvent = (e: Event) => {
			const detail = (e as CustomEvent).detail as { id?: string }
			if (detail?.id) {
				void removeItem(detail.id)
			}
		}
		window.addEventListener("htmlPreviewClear", handleClearEvent)

		const subscription = HtmlPreviewServiceClient.subscribeToHtmlPreviews(EmptyRequest.create(), {
			onResponse: (item: HtmlPreviewItem) => {
				const op = item.metadata?.__operation
				if (op === "clear") {
					setItems([])
					setActiveItemId(null)
					return
				}
				if (op === "remove") {
					let nextItems: HtmlPreviewItem[] = []
					setItems((prev) => {
						nextItems = prev.filter((i) => i.id !== item.id)
						return nextItems
					})
					if (activeItemIdRef.current === item.id) {
						setActiveItemId(nextItems.length > 0 ? nextItems[nextItems.length - 1].id : null)
					}
					return
				}
				setItems((prev) => {
					const idx = prev.findIndex((i) => i.id === item.id)
					if (idx >= 0) {
						const next = [...prev]
						next[idx] = item
						return next
					}
					return [...prev, item]
				})
				if (!activeItemIdRef.current) {
					setActiveItemId(item.id)
				}
			},
			onError: (error) => {
				console.error("[HtmlPreviewContext] Subscription error:", error)
			},
			onComplete: () => {
				console.log("[HtmlPreviewContext] Subscription completed")
			},
		})

		return () => {
			window.removeEventListener("htmlPreviewClear", handleClearEvent)
			subscription()
		}
	}, [refreshItems, removeItem])

	const clearAllItems = useCallback(async () => {
		setItems([])
		setActiveItemId(null)
		setManifestsById({})
		try {
			const { ClearHtmlPreviewRequest } = await import("@shared/proto/cline/html_preview")
			await HtmlPreviewServiceClient.clearHtmlPreview(ClearHtmlPreviewRequest.create({}))
		} catch (error) {
			console.error("[HtmlPreviewContext] Failed to clear all previews:", error)
		}
	}, [])

	const addItemFromContent = useCallback(async (title: string, htmlContent: string, filePath?: string) => {
		try {
			const { PreviewHtmlRequest } = await import("@shared/proto/cline/html_preview")
			await HtmlPreviewServiceClient.previewHtml(
				PreviewHtmlRequest.create({
					htmlContent,
					title,
					filePath: filePath || "",
					// mode omitted → UNSPECIFIED → extension auto-detects
				}),
			)
		} catch (error) {
			console.error("[HtmlPreviewContext] addItemFromContent failed:", error)
			throw error
		}
	}, [])

	const loadWorkspaceFile = useCallback(async (filePath: string, title: string) => {
		try {
			const { PreviewHtmlRequest } = await import("@shared/proto/cline/html_preview")
			await HtmlPreviewServiceClient.previewHtml(
				PreviewHtmlRequest.create({
					htmlContent: "",
					title,
					filePath,
				}),
			)
			// Fetch the updated item list, then activate the newly loaded item by
			// filePath so the view actually switches to the target module.
			const response = await HtmlPreviewServiceClient.getHtmlPreviewState(EmptyRequest.create())
			setItems(response.items)
			const newItem = response.items.find((i) => i.filePath === filePath)
			if (newItem) {
				setActiveItemId(newItem.id)
			} else if (response.items.length > 0) {
				// Fallback: activate the last item (most recently added)
				setActiveItemId(response.items[response.items.length - 1].id)
			}
		} catch (error) {
			console.error("[HtmlPreviewContext] loadWorkspaceFile failed:", error)
			throw error
		}
	}, [])

	return (
		<HtmlPreviewContext.Provider
			value={{
				items,
				activeItemId,
				setActiveItemId,
				refreshItems,
				removeItem,
				clearAllItems,
				addItemFromContent,
				loadWorkspaceFile,
				manifestsById,
				setManifest,
			}}>
			{children}
		</HtmlPreviewContext.Provider>
	)
}

export const useHtmlPreviewContext = () => useContext(HtmlPreviewContext)
