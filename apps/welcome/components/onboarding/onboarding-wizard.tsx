"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { StepConnection } from "./steps/step-connection"
import { StepAgentType } from "./steps/step-agent-type"
import { StepCustomAgent } from "./steps/step-custom-agent"
import { StepPlugins } from "./steps/step-plugins"
import { StepPlatform } from "./steps/step-platform"
import { StepConnectors } from "./steps/step-connectors"
import { StepDone } from "./steps/step-done"
import { ProgressIndicator } from "./progress-indicator"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { useClineHubClient, type ActiveConnector } from "@/lib/hub-client"

export type AgentType = "coding" | "assistant" | "custom" | null
export type Platform = "browser" | "clients" | "messengers" | null

export interface OnboardingState {
  isConnected: boolean
  agentType: AgentType
  customDescription: string
  selectedPlugins: string[]
  platform: Platform
  connectors: ActiveConnector[]
  connectorNames: Record<string, string>
}

const pageVariants = {
  initial: (direction: number) => ({
    x: direction > 0 ? 100 : -100,
    opacity: 0,
  }),
  in: {
    x: 0,
    opacity: 1,
  },
  out: (direction: number) => ({
    x: direction < 0 ? 100 : -100,
    opacity: 0,
  }),
}

const pageTransition = {
  type: "spring" as const,
  stiffness: 300,
  damping: 30,
}

export function OnboardingWizard() {
  const hub = useClineHubClient()
  const [currentStep, setCurrentStep] = useState(1)
  const [direction, setDirection] = useState(0)
  const [state, setState] = useState<OnboardingState>({
    isConnected: false,
    agentType: null,
    customDescription: "",
    selectedPlugins: [],
    platform: null,
    connectors: [],
    connectorNames: {},
  })

  const updateState = useCallback((updates: Partial<OnboardingState>) => {
    setState((prev) => ({ ...prev, ...updates }))
  }, [])

  const updateConnectors = useCallback(
    (connectors: ActiveConnector[], connectorNames: Record<string, string>) => {
      updateState({ connectors, connectorNames })
    },
    [updateState],
  )

  const getStepSequence = useCallback((): number[] => {
    const sequence = [1, 2]
    if (state.agentType === "custom") {
      sequence.push(3)
    }
    sequence.push(4, 5)
    if (state.platform === "messengers") {
      sequence.push(6)
    }
    sequence.push(7)
    return sequence
  }, [state.agentType, state.platform])

  const getCurrentStepIndex = useCallback(() => {
    const sequence = getStepSequence()
    return sequence.indexOf(currentStep)
  }, [currentStep, getStepSequence])

  const canGoBack = useCallback(() => {
    const index = getCurrentStepIndex()
    return index > 0 && currentStep !== 1
  }, [currentStep, getCurrentStepIndex])

  const canGoNext = useCallback(() => {
    const sequence = getStepSequence()
    const index = getCurrentStepIndex()
    
    if (currentStep === 1) return false // Auto-advances
    if (currentStep === 2 && !state.agentType) return false
    if (currentStep === 3 && !state.customDescription.trim()) return false
    if (currentStep === 5 && !state.platform) return false
    if (currentStep === 7) return false // Final step
    
    return index < sequence.length - 1
  }, [currentStep, state, getCurrentStepIndex, getStepSequence])

  const goToNextStep = useCallback(() => {
    const sequence = getStepSequence()
    const index = getCurrentStepIndex()
    if (index < sequence.length - 1) {
      setDirection(1)
      setCurrentStep(sequence[index + 1])
    }
  }, [getCurrentStepIndex, getStepSequence])

  const goToPrevStep = useCallback(() => {
    const sequence = getStepSequence()
    const index = getCurrentStepIndex()
    if (index > 0) {
      setDirection(-1)
      setCurrentStep(sequence[index - 1])
    }
  }, [getCurrentStepIndex, getStepSequence])

  // Handle connection state change
  useEffect(() => {
    if (state.isConnected && currentStep === 1) {
      const timer = setTimeout(() => {
        setDirection(1)
        setCurrentStep(2)
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [state.isConnected, currentStep])

  useEffect(() => {
    updateState({ isConnected: hub.isConnected })
  }, [hub.isConnected, updateState])

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <StepConnection
            errorMessage={hub.errorMessage}
            isConnected={hub.isConnected}
            onRetry={() => void hub.connect({ showProgress: true })}
            status={hub.status}
          />
        )
      case 2:
        return (
          <StepAgentType
            selected={state.agentType}
            onSelect={(type) => updateState({ agentType: type })}
          />
        )
      case 3:
        return (
          <StepCustomAgent
            description={state.customDescription}
            onChange={(desc) => updateState({ customDescription: desc })}
          />
        )
      case 4:
        return (
          <StepPlugins
            selected={state.selectedPlugins}
            onToggle={(plugin) => {
              const newPlugins = state.selectedPlugins.includes(plugin)
                ? state.selectedPlugins.filter((p) => p !== plugin)
                : [...state.selectedPlugins, plugin]
              updateState({ selectedPlugins: newPlugins })
            }}
          />
        )
      case 5:
        return (
          <StepPlatform
            selected={state.platform}
            onSelect={(platform) => updateState({ platform })}
          />
        )
      case 6:
        return (
          <StepConnectors
            connectors={state.connectors}
            connectorNames={state.connectorNames}
            hub={hub}
            onUpdate={updateConnectors}
          />
        )
      case 7:
        return <StepDone state={state} />
      default:
        return null
    }
  }

  const sequence = getStepSequence()
  const totalSteps = sequence.length

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 md:p-8">
      <div className="w-full max-w-2xl">
        {/* Progress */}
        <ProgressIndicator
          currentStep={getCurrentStepIndex() + 1}
          totalSteps={totalSteps}
        />

        {/* Step Content */}
        <div className="relative mt-8 min-h-[400px] sm:min-h-[450px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={pageVariants}
              initial="initial"
              animate="in"
              exit="out"
              transition={pageTransition}
              className="w-full"
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        {currentStep !== 1 && currentStep !== 7 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between mt-8 gap-4"
          >
            <button
              onClick={goToPrevStep}
              disabled={!canGoBack()}
              className="flex items-center gap-2 px-4 py-2.5 sm:px-6 sm:py-3 text-sm sm:text-base font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-lg hover:bg-secondary"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </button>

            <button
              onClick={goToNextStep}
              disabled={!canGoNext()}
              className="flex items-center gap-2 px-6 py-2.5 sm:px-8 sm:py-3 text-sm sm:text-base font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
            >
              <span>Continue</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </div>
    </div>
  )
}
