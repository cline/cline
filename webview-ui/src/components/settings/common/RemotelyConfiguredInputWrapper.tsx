import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function RemotelyConfiguredInputWrapper({ hidden, children }: React.PropsWithChildren<{ hidden: boolean }>) {
	return (
		<Tooltip>
			<TooltipContent hidden={hidden}>This setting is managed by your organization's remote configuration</TooltipContent>
			<TooltipTrigger>{children}</TooltipTrigger>
		</Tooltip>
	)
}

export const LockIcon = () => <i className="codicon codicon-lock text-description text-sm" />
