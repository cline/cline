import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"

// Configure the shared Logging class to use HostProvider's output channel
Logger.setOutput((msg: string) => HostProvider.get().logToChannel(msg))

// Re-export as Logger for backwards compatibility
export { Logger }
