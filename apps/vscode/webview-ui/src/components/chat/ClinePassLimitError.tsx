import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { useState } from "react";
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers";

interface ClinePassLimitErrorProps {
	message: string;
}

const ClinePassLimitError = ({ message }: ClinePassLimitErrorProps) => {
	const { handleFieldsChange } = useApiConfigurationHandlers();
	const [isSwitching, setIsSwitching] = useState(false);
	const [didSwitch, setDidSwitch] = useState(false);
	const [error, setError] = useState<string | undefined>();

	const handleSwitchToUsageBasedBilling = async () => {
		setIsSwitching(true);
		setError(undefined);
		try {
			await handleFieldsChange({
				planModeApiProvider: "cline",
				actModeApiProvider: "cline",
			});
			setDidSwitch(true);
		} catch (error) {
			console.error("Failed to switch to Cline usage-based billing:", error);
			setError(
				"Failed to switch provider. Select Cline Usage-Billing in API Configuration settings.",
			);
		} finally {
			setIsSwitching(false);
		}
	};

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="cline-pass-limit-error"
		>
			<div className="text-error mb-2">ClinePass limit reached</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">
				{message}
			</div>
			<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
				Would you like to switch to Usage-Based billing and retry with the
				Cline provider?
			</div>
			<VSCodeButton
				appearance="primary"
				className="w-full mt-3"
				disabled={isSwitching || didSwitch}
				onClick={handleSwitchToUsageBasedBilling}
			>
				{isSwitching
					? "Switching..."
					: didSwitch
						? "Switched to Usage-Based billing"
						: "Switch to Usage-Based billing"}
			</VSCodeButton>
			{didSwitch && (
				<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
					Retry the request after switching.
				</div>
			)}
			{error && <div className="text-error text-xs mt-2">{error}</div>}
		</div>
	);
};

export default ClinePassLimitError;
