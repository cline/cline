import { name, publisher, version } from "../package.json"

const prefix = name === "claude-dev" ? "cline" : name === "ai-hydro" ? "aihydro" : name

/**
 * List of commands with the name of the extension they are registered under.
 * These should match the command IDs defined in package.json.
 * For Nightly build, the publish script has updated all the commands to use the extension name as prefix.
 * In production, all commands are registered under "aihydro" for consistency.
 */
const AiHydroCommands = {
	PlusButton: prefix + ".plusButtonClicked",
	McpButton: prefix + ".mcpButtonClicked",
	MapButton: prefix + ".mapButtonClicked",
	SettingsButton: prefix + ".settingsButtonClicked",
	HistoryButton: prefix + ".historyButtonClicked",
	ConnectorsButton: prefix + ".connectorsButtonClicked",
	TerminalOutput: prefix + ".addTerminalOutputToChat",
	AddToChat: prefix + ".addToChat",
	FixWithAiHydro: prefix + ".fixWithAiHydro",
	ExplainCode: prefix + ".explainCode",
	ImproveCode: prefix + ".improveCode",
	FocusChatInput: prefix + ".focusChatInput",
	Walkthrough: prefix + ".openWalkthrough",
	GenerateCommit: prefix + ".generateGitCommitMessage",
	AbortCommit: prefix + ".abortGitCommitMessage",
	ReconstructTaskHistory: prefix + ".reconstructTaskHistory",
	LoadGeojsonToMap: prefix + ".loadGeojsonToMap",
	AddFileToMap: prefix + ".addFileToMap",
	AddMapLayerFromUrl: prefix + ".map.addLayerFromUrl",
	MapGallery: prefix + ".map.gallery",
	SaveMapScene: prefix + ".map.saveScene",
	OpenMapScene: prefix + ".map.openScene",
	GeeConnect: prefix + ".gee.connect",
	GeeStatus: prefix + ".gee.status",
	GeeTest: prefix + ".gee.test",
	GeeChooseProject: prefix + ".gee.chooseProject",
	GeePreviewChirpsLayer: prefix + ".gee.previewChirpsLayer",
	GeeDisconnect: prefix + ".gee.disconnect",
	HtmlPreviewButton: prefix + ".htmlPreviewButtonClicked",
	AddFileToHtmlPreview: prefix + ".addFileToHtmlPreview",
	ValidateModule: prefix + ".validateModule",
	SkillsButton: prefix + ".skillsButtonClicked",
	ExperimentTableButton: prefix + ".experimentTableButtonClicked",
	SessionReplayButton: prefix + ".sessionReplayButtonClicked",
}

/**
 * IDs for the views registered by the extension.
 * These should match the prefix + view IDs defined in package.json.
 */
const AiHydroViewIds = {
	Sidebar: prefix + ".SidebarProvider",
}

/**
 * The registry info for the extension, including its ID, name, version, commands, and views
 * registered for the current host.
 */
export const ExtensionRegistryInfo = {
	id: publisher + "." + name,
	name,
	version,
	publisher,
	commands: AiHydroCommands,
	views: AiHydroViewIds,
}
