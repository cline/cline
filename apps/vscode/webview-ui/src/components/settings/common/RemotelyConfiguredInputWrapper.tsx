import { useTranslation } from "react-i18next"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function RemotelyConfiguredInputWrapper({ hidden, children }: React.PropsWithChildren<{ hidden: boolean }>) {
	const { t } = useTranslation()
	return (
		<Tooltip>
			<TooltipContent hidden={hidden}>{t("settings:remoteManaged.tooltip")}</TooltipContent>
			<TooltipTrigger>{children}</TooltipTrigger>
		</Tooltip>
	)
}

export const LockIcon = () => <i className="codicon codicon-lock text-description text-sm" />
