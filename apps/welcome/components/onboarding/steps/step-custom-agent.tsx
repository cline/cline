"use client"

import { motion } from "framer-motion"
import { Lightbulb } from "lucide-react"

interface StepCustomAgentProps {
  description: string
  onChange: (description: string) => void
}

const suggestions = [
  "Research assistant for papers",
  "Support bot for my app",
  "Writing coach for emails",
  "Data analyst for spreadsheets",
]

export function StepCustomAgent({ description, onChange }: StepCustomAgentProps) {
  return (
    <div className="text-center px-4">
      <motion.h2
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl sm:text-3xl font-bold text-foreground mb-3 text-balance"
      >
        What should it do?
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-muted-foreground mb-8 text-sm sm:text-base"
      >
        Describe your agent in a few words
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="max-w-lg mx-auto"
      >
        <textarea
          value={description}
          onChange={(e) => onChange(e.target.value)}
          placeholder="My agent will..."
          className="w-full h-32 sm:h-40 p-4 text-base bg-card border-2 border-border rounded-xl resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50"
        />

        <div className="mt-6">
          <div className="flex items-center gap-2 text-muted-foreground mb-3">
            <Lightbulb className="w-4 h-4" />
            <span className="text-sm font-medium">Try these:</span>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {suggestions.map((suggestion, index) => (
              <motion.button
                key={suggestion}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + index * 0.05 }}
                onClick={() => onChange(suggestion)}
                className="px-3 py-1.5 text-xs sm:text-sm bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-full transition-colors"
              >
                {suggestion}
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
