"use client"

import { motion } from "framer-motion"
import { PartyPopper, Rocket, ArrowRight } from "lucide-react"
import type { OnboardingState } from "../onboarding-wizard"

interface StepDoneProps {
  state: OnboardingState
}

export function StepDone({ state }: StepDoneProps) {
  const agentLabel =
    state.agentType === "coding"
      ? "Coding Agent"
      : state.agentType === "assistant"
      ? "Personal Assistant"
      : "Custom Agent"
  const connectorLabels = state.connectors.map(
    (connector) => state.connectorNames[connector.type] ?? connector.type,
  )

  return (
    <div className="text-center px-4">
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="mb-6"
      >
        <div className="inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-primary/10">
          <PartyPopper className="w-10 h-10 sm:w-12 sm:h-12 text-primary" />
        </div>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-2xl sm:text-3xl font-bold text-foreground mb-3 text-balance"
      >
        All done!
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-muted-foreground mb-8 text-sm sm:text-base"
      >
        Your agent is ready
      </motion.p>

      {/* Summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-card border-2 border-border rounded-xl p-4 sm:p-6 max-w-md mx-auto mb-8"
      >
        <h3 className="font-semibold text-foreground mb-4 text-left">Summary</h3>
        <div className="space-y-3 text-sm text-left">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Agent Type</span>
            <span className="font-medium text-foreground">{agentLabel}</span>
          </div>
          {state.agentType === "custom" && state.customDescription && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground flex-shrink-0">Description</span>
              <span className="font-medium text-foreground truncate">
                {state.customDescription}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Plugins</span>
            <span className="font-medium text-foreground">
              {state.selectedPlugins.length} selected
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Platform</span>
            <span className="font-medium text-foreground capitalize">
              {state.platform === "clients"
                ? "Cline Clients"
                : state.platform === "messengers"
                ? "Messengers"
                : state.platform}
            </span>
          </div>
          {state.platform === "messengers" && state.connectors.length > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Connectors</span>
              <span className="truncate font-medium text-foreground">
                {connectorLabels.join(", ")}
              </span>
            </div>
          )}
        </div>
      </motion.div>

      {/* CTA Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="flex flex-col sm:flex-row items-center justify-center gap-3"
      >
        <button className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-all shadow-md hover:shadow-lg w-full sm:w-auto justify-center">
          <Rocket className="w-5 h-5" />
          <span>Launch Agent</span>
        </button>
        <button className="flex items-center gap-2 px-6 py-3 bg-secondary text-secondary-foreground rounded-xl font-medium hover:bg-secondary/80 transition-colors w-full sm:w-auto justify-center">
          <span>View Dashboard</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </motion.div>
    </div>
  )
}
