import { ApiConfiguration } from "@shared/api"

export interface ProviderOptionsProps {
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
}
