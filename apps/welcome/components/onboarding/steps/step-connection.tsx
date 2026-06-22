"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import {
  Check,
  CheckCircle2,
  Copy,
  RefreshCw,
  Terminal,
  Wifi,
  WifiOff,
} from "lucide-react"
import type { HubConnectionStatus } from "@/lib/hub-client"

interface StepConnectionProps {
  errorMessage: string | null
  isConnected: boolean
  onRetry: () => void
  status: HubConnectionStatus
}

const DASHBOARD_COMMAND = "cline dashboard"

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall back to the selection-based copy path for browsers that block the Clipboard API.
    }
  }

  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.setAttribute("readonly", "")
  textArea.style.left = "-9999px"
  textArea.style.position = "fixed"
  textArea.style.top = "0"

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  const copied = document.execCommand("copy")
  document.body.removeChild(textArea)

  if (!copied) {
    throw new Error("Unable to copy command.")
  }
}

export function StepConnection({
  errorMessage,
  isConnected,
  onRetry,
  status,
}: StepConnectionProps) {
  const checking = status === "connecting"
  const [copied, setCopied] = useState(false)
  const copiedResetTimeout = useRef<number | null>(null)

  const copyDashboardCommand = useCallback(async () => {
    try {
      await copyTextToClipboard(DASHBOARD_COMMAND)
      setCopied(true)
      if (copiedResetTimeout.current) {
        window.clearTimeout(copiedResetTimeout.current)
      }
      copiedResetTimeout.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (copiedResetTimeout.current) {
        window.clearTimeout(copiedResetTimeout.current)
      }
    }
  }, [])

  return (
    <div className="text-center px-4">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="mb-6"
      >
        {isConnected ? (
          <div className="inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-primary/10">
            <CheckCircle2 className="w-10 h-10 sm:w-12 sm:h-12 text-primary" />
          </div>
        ) : (
          <div className="inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-accent/10">
            {checking ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              >
                <Wifi className="w-10 h-10 sm:w-12 sm:h-12 text-accent" />
              </motion.div>
            ) : (
              <WifiOff className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground" />
            )}
          </div>
        )}
      </motion.div>

      <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3 text-balance">
        {isConnected ? "Connected!" : checking ? "Connecting..." : "Not connected"}
      </h2>

      <p className="text-muted-foreground mb-8 max-w-md mx-auto text-sm sm:text-base">
        {isConnected
          ? "Cline Hub is ready. Let's set up your agent."
          : "Run the local Hub dashboard so this page can finish setup."}
      </p>

      {!isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card border-2 border-border rounded-xl p-4 sm:p-6 max-w-md mx-auto"
        >
          <div className="flex items-center gap-2 mb-3">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Run this command
            </span>
          </div>
          <button
            aria-label={`Copy ${DASHBOARD_COMMAND}`}
            className="flex w-full items-center justify-between gap-3 rounded-lg bg-foreground/5 p-3 text-left font-mono text-sm text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4 sm:text-base"
            onClick={() => void copyDashboardCommand()}
            type="button"
          >
            <span>{DASHBOARD_COMMAND}</span>
            <span className="inline-flex items-center gap-1.5 font-sans text-xs font-medium text-muted-foreground">
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </span>
          </button>
          <p className="text-xs text-muted-foreground mt-3">
            {checking ? "Looking for Cline Hub..." : "Cline Hub is not connected."}
          </p>
          {errorMessage && !checking ? (
            <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-left text-xs text-destructive">
              {errorMessage}
            </p>
          ) : null}
          <button
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={checking}
            onClick={onRetry}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
            Retry
          </button>
        </motion.div>
      )}

      {isConnected && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-medium"
        >
        <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
        Continuing...
        </motion.div>
      )}
    </div>
  )
}
