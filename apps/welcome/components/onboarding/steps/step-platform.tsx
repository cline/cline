"use client"

import { motion } from "framer-motion"
import { Globe, Monitor, MessageCircle } from "lucide-react"
import type { Platform } from "../onboarding-wizard"

interface StepPlatformProps {
  selected: Platform
  onSelect: (platform: Platform) => void
}

const platforms = [
  {
    id: "browser" as const,
    title: "Browser",
    description: "Use in any web browser",
    icon: Globe,
  },
  {
    id: "clients" as const,
    title: "Cline Clients",
    description: "CLI, VS Code & more",
    icon: Monitor,
  },
  {
    id: "messengers" as const,
    title: "Messengers",
    description: "Discord, Telegram & more",
    icon: MessageCircle,
  },
]

export function StepPlatform({ selected, onSelect }: StepPlatformProps) {
  return (
    <div className="text-center px-4">
      <motion.h2
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl sm:text-3xl font-bold text-foreground mb-3 text-balance"
      >
        Where will you use it?
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-muted-foreground mb-8 text-sm sm:text-base"
      >
        Pick your platform
      </motion.p>

      <div className="grid gap-4 max-w-lg mx-auto">
        {platforms.map((platform, index) => {
          const Icon = platform.icon
          const isSelected = selected === platform.id

          return (
            <motion.button
              key={platform.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => onSelect(platform.id)}
              className={`flex items-center gap-4 p-4 sm:p-5 rounded-xl border-2 text-left transition-all ${
                isSelected
                  ? "border-primary bg-primary/5 shadow-md"
                  : "border-border bg-card hover:border-primary/50 hover:bg-secondary/50"
              }`}
            >
              <div
                className={`flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-lg flex items-center justify-center transition-colors ${
                  isSelected ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                }`}
              >
                <Icon className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-foreground text-base sm:text-lg">
                  {platform.title}
                </h3>
                <p className="text-muted-foreground text-sm">{platform.description}</p>
              </div>
              <div
                className={`flex-shrink-0 w-5 h-5 rounded-full border-2 transition-all ${
                  isSelected
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/30"
                }`}
              >
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-full h-full flex items-center justify-center"
                  >
                    <div className="w-2 h-2 bg-primary-foreground rounded-full" />
                  </motion.div>
                )}
              </div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
