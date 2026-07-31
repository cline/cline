import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EntitlementError from "./EntitlementError";

const mockAuth: { clineUser: { appBaseUrl?: string } | null } = {
	clineUser: null,
};

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => mockAuth,
}));

const mockExtensionState: {
	apiConfiguration: Record<string, unknown>;
	mode: "plan" | "act";
	clineModels: Record<string, unknown>;
} = {
	apiConfiguration: {},
	mode: "act",
	clineModels: {},
};

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}));

const handleModeFieldsChangeMock = vi.fn();
vi.mock("@/components/settings/utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: () => ({
		handleModeFieldsChange: (...args: unknown[]) =>
			handleModeFieldsChangeMock(...args),
	}),
}));

const askResponseMock = vi.fn();
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		askResponse: (...args: unknown[]) => askResponseMock(...args),
	},
}));

const getSubscribeHref = () =>
	screen.getByRole("link", { name: /get clinepass/i }).getAttribute("href");
const querySubscribeLink = () =>
	screen.queryByRole("link", { name: /get clinepass/i });
const querySwitchButton = () =>
	screen.queryByText(/switch to usage-based billing/i);

function useClinePassSelection(modelId = "cline-pass/deepseek-v4-flash") {
	mockExtensionState.apiConfiguration = {
		actModeApiProvider: "cline-pass",
		actModeClinePassModelId: modelId,
	};
	mockExtensionState.clineModels = {
		"deepseek/deepseek-v4-flash": {
			name: "deepseek-v4-flash",
			contextWindow: 1_048_576,
		},
		"anthropic/claude-opus-4.6": {
			name: "claude-opus-4.6",
			contextWindow: 200_000,
		},
	};
}

describe("EntitlementError", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuth.clineUser = null;
		mockExtensionState.apiConfiguration = {};
		mockExtensionState.mode = "act";
		mockExtensionState.clineModels = {};
		handleModeFieldsChangeMock.mockResolvedValue(undefined);
	});

	it("shows friendly copy with the backend detail as muted support text", () => {
		render(
			<EntitlementError message="Error 403: the user is not subscribed to required model plan" />,
		);
		expect(
			screen.getByText("This model requires a ClinePass subscription."),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"Error 403: the user is not subscribed to required model plan",
			),
		).toBeInTheDocument();
	});

	it("omits the subscribe link when no usable app base URL is available", () => {
		render(<EntitlementError />);
		expect(querySubscribeLink()).toBeNull();

		mockAuth.clineUser = {};
		render(<EntitlementError />);
		expect(querySubscribeLink()).toBeNull();

		mockAuth.clineUser = { appBaseUrl: "not a valid url" };
		render(<EntitlementError />);
		expect(querySubscribeLink()).toBeNull();
	});

	it("builds the subscribe link from the authenticated user's app base URL", () => {
		mockAuth.clineUser = { appBaseUrl: "https://staging-app.cline.bot" };
		const { unmount } = render(<EntitlementError />);
		expect(getSubscribeHref()).toBe(
			"https://staging-app.cline.bot/dashboard/subscription?personal=true",
		);
		unmount();

		mockAuth.clineUser = {
			appBaseUrl: "https://proxy.enterprise.com/cline/app",
		};
		render(<EntitlementError />);
		expect(getSubscribeHref()).toBe(
			"https://proxy.enterprise.com/cline/app/dashboard/subscription?personal=true",
		);
	});

	it("sends a yesButtonClicked askResponse when Retry Request is clicked", () => {
		render(<EntitlementError />);
		// VSCodeButton has no ARIA role in jsdom; click by label text instead.
		fireEvent.click(screen.getByText("Retry Request"));
		expect(askResponseMock).toHaveBeenCalledTimes(1);
		expect(askResponseMock.mock.calls[0][0]).toMatchObject({
			responseType: "yesButtonClicked",
		});
	});

	it("offers the usage-billed counterpart of the selected ClinePass model", () => {
		useClinePassSelection();
		render(<EntitlementError />);
		expect(
			screen.getByText(
				"Usage-based billing runs this model as deepseek/deepseek-v4-flash, charged to your Cline account balance.",
			),
		).toBeInTheDocument();
		expect(querySwitchButton()).not.toBeNull();
	});

	it("switches the provider and model to usage-based billing", async () => {
		useClinePassSelection();
		render(<EntitlementError />);

		fireEvent.click(screen.getByText("Switch to Usage-Based billing"));

		await waitFor(() =>
			expect(handleModeFieldsChangeMock).toHaveBeenCalledTimes(1),
		);
		expect(handleModeFieldsChangeMock.mock.calls[0][1]).toMatchObject({
			apiProvider: "cline",
			clineModelId: "deepseek/deepseek-v4-flash",
		});
		expect(handleModeFieldsChangeMock.mock.calls[0][2]).toBe("act");
		await screen.findByText("Switched to Usage-Based billing");
	});

	it("keeps the confirmation visible after the config moves off cline-pass", async () => {
		useClinePassSelection();
		// The real switch rewrites the provider, which clears the ClinePass
		// selection the counterpart was resolved from.
		handleModeFieldsChangeMock.mockImplementation(async () => {
			mockExtensionState.apiConfiguration = {
				actModeApiProvider: "cline",
				actModeClineModelId: "deepseek/deepseek-v4-flash",
			};
		});
		render(<EntitlementError />);

		fireEvent.click(screen.getByText("Switch to Usage-Based billing"));

		await screen.findByText("Switched to Usage-Based billing");
		expect(
			screen.getByText("Retry the request after switching."),
		).toBeInTheDocument();
	});

	it("hides the switch action when the catalog has no usage-billed counterpart", () => {
		mockExtensionState.apiConfiguration = {
			actModeApiProvider: "cline-pass",
			actModeClinePassModelId: "cline-pass/some-unlisted-model",
		};
		mockExtensionState.clineModels = {
			"deepseek/deepseek-v4-flash": { name: "deepseek-v4-flash" },
		};
		render(<EntitlementError />);
		expect(querySwitchButton()).toBeNull();
	});

	it("hides the switch action when the selected provider is not cline-pass", () => {
		mockExtensionState.apiConfiguration = {
			actModeApiProvider: "cline",
			actModeClineModelId: "deepseek/deepseek-v4-flash",
		};
		mockExtensionState.clineModels = {
			"deepseek/deepseek-v4-flash": { name: "deepseek-v4-flash" },
		};
		render(<EntitlementError />);
		expect(querySwitchButton()).toBeNull();
	});
});
