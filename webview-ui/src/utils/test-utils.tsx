import React from "react"
import { render, RenderOptions } from "@testing-library/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { STANDARD_TOOLTIP_DELAY } from "@/components/ui/standard-tooltip"

interface AllTheProvidersProps {
	children: React.ReactNode
}

const AllTheProviders = ({ children }: AllTheProvidersProps) => {
	return <TooltipProvider delayDuration={STANDARD_TOOLTIP_DELAY}>{children}</TooltipProvider>
}

const customRender = (ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
	render(ui, { wrapper: AllTheProviders, ...options })

// re-export everything
export * from "@testing-library/react"

// override render method
export { customRender as render }
