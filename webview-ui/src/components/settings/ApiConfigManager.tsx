import { VSCodeButton, VSCodeDivider, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"
import { ApiConfigMeta } from "../../../../src/shared/ExtensionMessage"

interface ApiConfigManagerProps {
    currentApiConfigName?: string
    listApiConfigMeta?: ApiConfigMeta[]
    onSelectConfig: (configName: string) => void
    onDeleteConfig: (configName: string) => void
    onRenameConfig: (oldName: string, newName: string) => void
    onUpsertConfig: (configName: string) => void
    // setDraftNewConfig: (mode: boolean) => void
}

const ApiConfigManager = ({
    currentApiConfigName,
    listApiConfigMeta,
    onSelectConfig,
    onDeleteConfig,
    onRenameConfig,
    onUpsertConfig,
    // setDraftNewConfig,
}: ApiConfigManagerProps) => {
    const [isNewMode, setIsNewMode] = useState(false);
    const [isRenameMode, setIsRenameMode] = useState(false);
    const [newConfigName, setNewConfigName] = useState("");
    const [renamedConfigName, setRenamedConfigName] = useState("");

    const handleNewConfig = () => {
        setIsNewMode(true);
        setNewConfigName("");
        // setDraftNewConfig(true)
    };

    const handleSaveNewConfig = () => {
        if (newConfigName.trim()) {
            onUpsertConfig(newConfigName.trim());
            setIsNewMode(false);
            setNewConfigName("");
            // setDraftNewConfig(false)
        }
    };

    const handleCancelNewConfig = () => {
        setIsNewMode(false);
        setNewConfigName("");
        // setDraftNewConfig(false)
    };

    const handleStartRename = () => {
        setIsRenameMode(true);
        setRenamedConfigName(currentApiConfigName || "");
    };

    const handleSaveRename = () => {
        if (renamedConfigName.trim() && currentApiConfigName) {
            onRenameConfig(currentApiConfigName, renamedConfigName.trim());
            setIsRenameMode(false);
            setRenamedConfigName("");
        }
    };

    const handleCancelRename = () => {
        setIsRenameMode(false);
        setRenamedConfigName("");
    };

    return (
        <div>
            <label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>
                API Configuration
            </label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {isNewMode ? (
                    <>
                        <VSCodeTextField
                            value={newConfigName}
                            onInput={(e: any) => setNewConfigName(e.target.value)}
                            placeholder="Enter configuration name"
                            style={{ flexGrow: 1 }}
                        />
                        <VSCodeButton
                            appearance="secondary"
                            disabled={!newConfigName.trim()}
                            onClick={handleSaveNewConfig}
                        >
                            <span className="codicon codicon-check" /> Save
                        </VSCodeButton>
                        <VSCodeButton
                            appearance="secondary"
                            onClick={handleCancelNewConfig}
                        >
                            <span className="codicon codicon-close" /> Cancel
                        </VSCodeButton>
                    </>
                ) : isRenameMode ? (
                    <>
                        <VSCodeTextField
                            value={renamedConfigName}
                            onInput={(e: any) => setRenamedConfigName(e.target.value)}
                            placeholder="Enter new name"
                            style={{ flexGrow: 1 }}
                        />
                        <VSCodeButton
                            appearance="secondary"
                            disabled={!renamedConfigName.trim()}
                            onClick={handleSaveRename}
                        >
                            <span className="codicon codicon-check" /> Save
                        </VSCodeButton>
                        <VSCodeButton
                            appearance="secondary"
                            onClick={handleCancelRename}
                        >
                            <span className="codicon codicon-close" /> Cancel
                        </VSCodeButton>
                    </>
                ) : (
                    <>
                        <select
                            value={currentApiConfigName}
                            onChange={(e) => onSelectConfig(e.target.value)}
                            style={{
                                flexGrow: 1,
                                padding: "4px 8px",
                                backgroundColor: "var(--vscode-input-background)",
                                color: "var(--vscode-input-foreground)",
                                border: "1px solid var(--vscode-input-border)",
                                borderRadius: "2px",
                                height: "28px"
                            }}>
                            {listApiConfigMeta?.map((config) => (
                                <option key={config.name} value={config.name}>{config.name} {config.apiProvider ? `(${config.apiProvider})` : ""}
                                </option>
                            ))}
                        </select>
                        <VSCodeButton
                            appearance="secondary"
                            onClick={handleNewConfig}
                        >
                            <span className="codicon codicon-add" /> New
                        </VSCodeButton>
                        <VSCodeButton
                            appearance="secondary"
                            disabled={!currentApiConfigName}
                            onClick={handleStartRename}
                        >
                            <span className="codicon codicon-edit" /> Rename
                        </VSCodeButton>
                        <VSCodeButton
                            appearance="secondary"
                            disabled={!currentApiConfigName}
                            onClick={() => onDeleteConfig(currentApiConfigName!)}
                        >
                            <span className="codicon codicon-trash" /> Delete
                        </VSCodeButton>
                    </>
                )}
            </div>
            <VSCodeDivider style={{ margin: "15px 0" }} />
        </div>
    )
}

export default memo(ApiConfigManager)