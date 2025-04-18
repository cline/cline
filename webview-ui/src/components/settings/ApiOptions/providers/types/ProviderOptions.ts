import { ApiConfiguration } from "@shared/api"

export interface ProviderOptionsProps {
	showModelOptions?: boolean
	isPopup?: boolean
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
}
