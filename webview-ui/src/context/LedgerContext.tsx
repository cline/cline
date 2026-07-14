import { EmptyRequest } from "@shared/proto/cline/common"
import type { ClaimRecord, ClaimUpdate } from "@shared/proto/cline/ledger"
import { GetLedgerStateRequest as GetLedgerStateRequestMsg } from "@shared/proto/cline/ledger"
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { LedgerServiceClient } from "../services/grpc-client"

interface LedgerContextType {
	/** All known claims keyed by claim_id. */
	claims: Record<string, ClaimRecord>
	/** Session id that claims belong to (most recently loaded). */
	sessionId: string
	/** Reload claims for a specific session id. Empty string → most recent. */
	loadSession: (sessionId: string) => Promise<void>
	/** True while a ledger snapshot request is in flight. */
	loading: boolean
	/** Last ledger load/subscription error shown in evidence surfaces. */
	error: string | null
	/** Look up a single claim by id. */
	getClaim: (claimId: string) => ClaimRecord | undefined
}

const LedgerContext = createContext<LedgerContextType | undefined>(undefined)

export const LedgerContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [claims, setClaims] = useState<Record<string, ClaimRecord>>({})
	const [sessionId, setSessionId] = useState<string>("")
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const subRef = useRef<(() => void) | null>(null)

	const loadSession = useCallback(async (sid: string) => {
		setLoading(true)
		setError(null)
		try {
			const req = GetLedgerStateRequestMsg.create({ sessionId: sid })
			const resp = await LedgerServiceClient.getLedgerState(req)
			const byId: Record<string, ClaimRecord> = {}
			for (const c of resp.claims) {
				byId[c.claimId] = c
			}
			setClaims(byId)
			setSessionId(resp.sessionId)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			console.error("[LedgerContext] Failed to load session claims:", error)
			setError(message)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		// Initial load of most-recently-active session
		void loadSession("")

		// Subscribe to live updates from LedgerEventWatcher
		subRef.current = LedgerServiceClient.subscribeToClaimUpdates(EmptyRequest.create({}), {
			onResponse: (update: ClaimUpdate) => {
				if (!update.claim) {
					return
				}
				const c = update.claim
				setClaims((prev) => {
					if (update.changeType === "removed") {
						const next = { ...prev }
						delete next[c.claimId]
						return next
					}
					return { ...prev, [c.claimId]: c }
				})
				if (c.sessionId && !sessionId) {
					setSessionId(c.sessionId)
				}
			},
			onError: (error) => {
				const message = error instanceof Error ? error.message : String(error)
				console.error("[LedgerContext] Subscription error:", error)
				setError(message)
			},
			onComplete: () => {},
		})

		return () => {
			subRef.current?.()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	const getClaim = useCallback((claimId: string) => claims[claimId], [claims])

	return (
		<LedgerContext.Provider value={{ claims, sessionId, loadSession, loading, error, getClaim }}>
			{children}
		</LedgerContext.Provider>
	)
}

export const useLedgerContext = () => {
	const ctx = useContext(LedgerContext)
	if (!ctx) {
		throw new Error("useLedgerContext must be used within LedgerContextProvider")
	}
	return ctx
}
