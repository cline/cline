import { EmptyRequest } from "@shared/proto/cline/common"
import type { MapLayer, MapRoi } from "@shared/proto/cline/map"
import { SetActiveRoiRequest } from "@shared/proto/cline/map"
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { ActiveRoi } from "../components/map/mapWorkspace"
import { MapServiceClient } from "../services/grpc-client"

interface MapContextType {
	layers: MapLayer[]
	activeRoi: ActiveRoi | undefined
	addLayer: (layer: MapLayer) => void
	removeLayer: (layerId: string) => void
	clearLayers: () => void
	getLayer: (layerId: string) => MapLayer | undefined
	setActiveRoiOnHost: (roi: ActiveRoi | undefined, geojson?: string) => Promise<void>
	refreshSessionRoi: () => Promise<void>
}

const MapContext = createContext<MapContextType | undefined>(undefined)
const MAP_OPERATION_KEY = "__operation"

function protoToActiveRoi(roi?: MapRoi): ActiveRoi | undefined {
	if (!roi?.name && !roi?.geojson) {
		return undefined
	}
	return {
		id: roi.id,
		name: roi.name,
		source: roi.source,
		areaHa: roi.areaHa,
	}
}

export const MapContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [layers, setLayers] = useState<MapLayer[]>([])
	const [activeRoi, setActiveRoi] = useState<ActiveRoi | undefined>()
	const layerSubRef = useRef<(() => void) | null>(null)
	const sessionSubRef = useRef<(() => void) | null>(null)

	const applyIncomingLayer = useCallback((prevLayers: MapLayer[], incomingLayer: MapLayer): MapLayer[] => {
		const operation = incomingLayer.metadata?.[MAP_OPERATION_KEY]

		if (operation === "clear") {
			return []
		}

		if (operation === "remove") {
			return prevLayers.filter((layer) => layer.id !== incomingLayer.id)
		}

		const existingIndex = prevLayers.findIndex((layer) => layer.id === incomingLayer.id)
		if (existingIndex >= 0) {
			const nextLayers = [...prevLayers]
			nextLayers[existingIndex] = incomingLayer
			return nextLayers
		}
		return [...prevLayers, incomingLayer]
	}, [])

	useEffect(() => {
		MapServiceClient.getMapState(EmptyRequest.create({}))
			.then((response) => {
				setLayers(response.layers || [])
			})
			.catch((error) => {
				console.error("[MapContext] Failed to fetch initial map state:", error)
			})

		MapServiceClient.getMapSession(EmptyRequest.create({}))
			.then((session) => {
				setActiveRoi(protoToActiveRoi(session.activeRoi))
			})
			.catch((error) => {
				console.error("[MapContext] Failed to fetch map session:", error)
			})

		layerSubRef.current = MapServiceClient.subscribeToMapLayers(EmptyRequest.create({}), {
			onResponse: (layer: MapLayer) => {
				setLayers((prevLayers) => applyIncomingLayer(prevLayers, layer))
			},
			onError: (error) => {
				console.error("[MapContext] Error in layer subscription:", error)
			},
			onComplete: () => {},
		})

		sessionSubRef.current = MapServiceClient.subscribeToMapSession(EmptyRequest.create({}), {
			onResponse: (session) => {
				setActiveRoi(protoToActiveRoi(session.activeRoi))
			},
			onError: (error) => {
				console.error("[MapContext] Error in map session subscription:", error)
			},
			onComplete: () => {},
		})

		return () => {
			layerSubRef.current?.()
			sessionSubRef.current?.()
		}
	}, [applyIncomingLayer])

	const setActiveRoiOnHost = useCallback(async (roi: ActiveRoi | undefined, geojson?: string) => {
		if (!roi?.name && !geojson) {
			await MapServiceClient.setActiveRoi(SetActiveRoiRequest.create({}))
			setActiveRoi(undefined)
			return
		}
		await MapServiceClient.setActiveRoi(
			SetActiveRoiRequest.create({
				roi: {
					id: roi.id || `roi_${Date.now()}`,
					name: roi.name || "ROI",
					source: roi.source || "map_draw",
					geojson: geojson || "",
					areaHa: roi.areaHa ?? 0,
					workspacePath: "",
				},
			}),
		)
		setActiveRoi(roi)
	}, [])

	const refreshSessionRoi = useCallback(async () => {
		const session = await MapServiceClient.getMapSession(EmptyRequest.create({}))
		setActiveRoi(protoToActiveRoi(session.activeRoi))
	}, [])

	const addLayer = useCallback((layer: MapLayer) => {
		setLayers((prevLayers) => {
			const existingIndex = prevLayers.findIndex((l) => l.id === layer.id)
			if (existingIndex >= 0) {
				const newLayers = [...prevLayers]
				newLayers[existingIndex] = layer
				return newLayers
			}
			return [...prevLayers, layer]
		})
	}, [])

	const removeLayer = useCallback((layerId: string) => {
		setLayers((prevLayers) => prevLayers.filter((l) => l.id !== layerId))
	}, [])

	const clearLayers = useCallback(() => {
		setLayers([])
	}, [])

	const getLayer = useCallback(
		(layerId: string) => {
			return layers.find((l) => l.id === layerId)
		},
		[layers],
	)

	return (
		<MapContext.Provider
			value={{
				layers,
				activeRoi,
				addLayer,
				removeLayer,
				clearLayers,
				getLayer,
				setActiveRoiOnHost,
				refreshSessionRoi,
			}}>
			{children}
		</MapContext.Provider>
	)
}

export const useMapContext = () => {
	const context = useContext(MapContext)
	if (!context) {
		throw new Error("useMapContext must be used within MapContextProvider")
	}
	return context
}
