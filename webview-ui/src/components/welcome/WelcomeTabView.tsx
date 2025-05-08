import { useState, useRef, useEffect, memo, Dispatch, SetStateAction } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { EmptyRequest } from "@shared/proto/common"
import ClineLogoWhite from "@/assets/ClineLogoWhite"

// Import CSS styles
import "@/assets/css/styles.css"
import { validateApiConfiguration } from "@/utils/validate" // Added import

const WelcomeTabView = ({ showWelcome }: { showWelcome: boolean }) => {
	const { apiConfiguration } = useExtensionState()
	const isApiConfigValid = validateApiConfiguration(apiConfiguration) === undefined
	const [activeTab, setActiveTab] = useState("Key Features")
	const inputFieldRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const [inputValue, setInputValue] = useState("")
	const [showPlaceholder, setShowPlaceholder] = useState(true)

	const handleLogin = () => {
		AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to get login URL:", err),
		)
	}

	const handleTabClick = (tabName: string) => {
		setActiveTab(tabName)
	}

	const handleInputFieldClick = () => {
		setShowPlaceholder(false)
		inputRef.current?.focus()
	}

	const handleInputBlur = () => {
		if (!inputValue) {
			setShowPlaceholder(true)
		}
	}

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setInputValue(e.target.value)
	}

	const handleCreateProject = (model: string) => {
		console.log(`Creating project with ${model} model`)
		// Implement project creation logic
	}

	// Equivalent to document.addEventListener("DOMContentLoaded", ...)
	useEffect(() => {
		// No need to implement DOM manipulation here as we're using React state
	}, [])

	return (
		<div className="home">
			<div className="main-container">
				{/* Account Info */}
				<div className="account-info">
					<ClineLogoWhite className="vector-icon" />

					<div className="welcome-message-container">
						<h1 className="welcome-message">Get Started on Cline</h1>
						<p className="description">Let's start and learn the basics of Cline</p>
					</div>

					<div className="buttons-container">
						<button className="primary-button" onClick={handleLogin}>
							Let's Create your Account!
						</button>
					</div>

					{/* Conditionally render features-container */}
					{isApiConfigValid && !showWelcome ? (
						<div className="features-container">
							<div className="feature-row">
								<div
									className="feature-card"
									style={{
										transition: "all 0.3s ease",
										cursor: "pointer",
									}}>
									<div className="feature-icon-container">
										<div className="feature-icon feature-icon-1"></div>
										<div className="feature-title">Snake game</div>
									</div>
									<div className="feature-description">&gt; Build a Snake game...</div>
								</div>

								<div
									className="feature-card"
									style={{
										transition: "all 0.3s ease",
										cursor: "pointer",
									}}>
									<div className="feature-icon-container">
										<div className="feature-icon feature-icon-2"></div>
										<div className="feature-title">To-do App</div>
									</div>
									<div className="feature-description">&gt; Generate a to-do App...</div>
								</div>

								<div
									className="feature-card"
									style={{
										transition: "all 0.3s ease",
										cursor: "pointer",
									}}>
									<div className="feature-icon-container">
										<div className="feature-icon feature-icon-3"></div>
										<div className="feature-title">Script</div>
									</div>
									<div className="feature-description">&gt; Write a script and then...</div>
								</div>

								<div
									className="feature-card"
									style={{
										transition: "all 0.3s ease",
										cursor: "pointer",
									}}>
									<div className="feature-icon-container">
										<div className="feature-icon feature-icon-4"></div>
										<div className="feature-title">New Feature</div>
									</div>
									<div className="feature-description">&gt; Read my code &amp; suggest...</div>
								</div>
							</div>
							<div className="footer">
								<div
									className="input-field"
									ref={inputFieldRef}
									onClick={handleInputFieldClick}
									style={{
										position: "relative",
										cursor: "text",
									}}>
									{showPlaceholder && <div className="input-placeholder">Type your prompt here...</div>}
									{!showPlaceholder && (
										<input
											ref={inputRef}
											type="text"
											value={inputValue}
											onChange={handleInputChange}
											onBlur={handleInputBlur}
											style={{
												width: "100%",
												background: "transparent",
												border: "none",
												outline: "none",
												color: "#FFFFFF",
												fontSize: "14px",
												fontFamily: "SF Pro, Inter, sans-serif",
											}}
										/>
									)}

									<div className="input-actions-container">
										<div className="input-actions">
											<button
												className="action-button action-button-secondary"
												style={{
													transition: "all 0.2s ease",
													opacity: 0.5,
												}}>
												<div className="action-icon action-icon-1"></div>
												<span className="action-text">Improve prompt</span>
											</button>

											<button
												className="action-button action-button-primary"
												style={{
													transition: "all 0.2s ease",
													opacity: 0.5,
												}}>
												<div className="action-icon action-icon-2"></div>
												<span className="action-text">Start construction</span>
											</button>
										</div>
									</div>
								</div>
							</div>
						</div>
					) : null}
					{/* End of conditional rendering for features-container */}
				</div>

				<div className="divider"></div>

				{/* Features Section */}
				<div className="features-section-container">
					<div className="features-text-container">
						<h2 className="features-heading">Work better with the best features of Cline</h2>
						<p className="features-description">
							It's easy to lose control as they make rapid changes to your codebase. That's why we built safe
							features to make the control on your code.
						</p>

						<div className="divider-dashed"></div>

						<div className="features-tabs-container">
							<button
								className={`tab-button ${activeTab === "Key Features" ? "active-tab" : ""}`}
								onClick={() => handleTabClick("Key Features")}>
								Key Features
							</button>
							<button
								className={`tab-button ${activeTab === "Tools" ? "active-tab" : ""}`}
								onClick={() => handleTabClick("Tools")}>
								Tools
							</button>
							<button
								className={`tab-button ${activeTab === "Checkpoints" ? "active-tab" : ""}`}
								onClick={() => handleTabClick("Checkpoints")}>
								Checkpoints
							</button>
						</div>

						{activeTab === "Key Features" && (
							<div className="feature-content">
								<div className="feature-selected">
									<div className="feature-check-icon">✓</div>
									<div className="feature-info">
										<h3 className="feature-title">File Editing</h3>
										<p className="feature-subtitle">Cline can write your code for you</p>
									</div>
								</div>

								<div className="feature-buttons-container">
									<button className="feature-action-button">
										<div className="feature-action-icon button-icon-1"></div>
										Create new files
									</button>

									<button className="feature-action-button">
										<div className="feature-action-icon button-icon-1"></div>
										Modify existing code
									</button>

									<button className="feature-action-button">
										<div className="feature-action-icon button-icon-1"></div>
										Search and replace across files
									</button>
								</div>

								<div className="feature-options">
									<div className="feature-option">
										<div className="feature-circle"></div>
										<span>Terminal Commands</span>
									</div>

									<div className="feature-option">
										<div className="feature-circle"></div>
										<span>Code Analysis</span>
									</div>

									<div className="feature-option">
										<div className="feature-circle"></div>
										<span>Browser Integration</span>
									</div>
								</div>
							</div>
						)}

						{activeTab === "Tools" && (
							<div className="feature-content">
								<p className="feature-description">Cline provides powerful tools to help you code faster</p>
							</div>
						)}

						{activeTab === "Checkpoints" && (
							<div className="feature-content">
								<p className="feature-description">Cline creates checkpoints to help you track changes</p>
							</div>
						)}
					</div>
				</div>

				<img alt="Feature Background" className="feature-bg" />

				<div className="divider"></div>

				{/* Models Section */}
				<div className="models-container">
					<h2 className="models-heading">Top 3 models for coding</h2>

					<div className="models-section-container">
						{/* Anthropic Model Card */}
						<div className="model-card">
							<div className="model-header">
								<div className="model-name">anthropic</div>
								<div className="model-badge best">Best</div>
							</div>

							<div className="model-description">Leading model for agentic coding</div>

							<div className="model-divider"></div>

							<div className="model-image anthropic-model"></div>

							<button className="model-button" onClick={() => handleCreateProject("anthropic")}>
								Create a new project
							</button>
						</div>

						{/* Google Model Card */}
						<div className="model-card">
							<div className="model-header">
								<div className="model-name">google</div>
								<div className="model-badge trending">Trending</div>
							</div>

							<div className="model-description">Large 1M context window, great value</div>

							<div className="model-divider"></div>

							<div className="model-image google-model"></div>

							<button className="model-button" onClick={() => handleCreateProject("google")}>
								Create a new project
							</button>
						</div>

						{/* Meta-Llama Model Card */}
						<div className="model-card">
							<div className="model-header">
								<div className="model-name">meta-llama</div>
								<div className="model-badge new">New</div>
							</div>

							<div className="model-description">Efficient performance at lower cost</div>

							<div className="model-divider"></div>

							<div className="model-image meta-model"></div>

							<button className="model-button" onClick={() => handleCreateProject("meta-llama")}>
								Create a new project
							</button>
						</div>
					</div>
				</div>

				<div className="divider"></div>

				{/* Plan/Act Mode Section */}
				<div className="plan-act-container">
					<h2 className="plan-act-heading">Plan/Act Mode</h2>
					<p className="plan-act-description">
						Switch between planning and execution modes to better control how Cline assists you. Plan mode helps you
						strategize while Act mode implements your solutions.
					</p>

					<div className="divider-dashed"></div>

					<div className="plan-act-content">
						{/* Plan Mode Column */}
						<div className="plan-mode-container">
							<div className="mode-header">
								<h3 className="mode-title">Plan Mode</h3>
							</div>
							<div className="mode-content">
								<div className="mode-item">
									<div className="mode-icon plan-icon">
										<div className="line-icon plan-line"></div>
									</div>
									<div className="mode-text">Read files & Analysis</div>
								</div>
								<div className="mode-item">
									<div className="mode-icon plan-icon">
										<div className="line-icon plan-line"></div>
									</div>
									<div className="mode-text">Strategy Development</div>
								</div>
								<div className="mode-item">
									<div className="mode-icon plan-icon">
										<div className="line-icon plan-line"></div>
									</div>
									<div className="mode-text">Context Gathering</div>
								</div>
								<div className="mode-item">
									<div className="mode-icon plan-icon">
										<div className="line-icon plan-line"></div>
									</div>
									<div className="mode-text">Requirements Analysis</div>
								</div>
								<div className="mode-item disabled">
									<div className="mode-icon plan-icon-disabled">
										<div className="line-icon disabled-line"></div>
									</div>
									<div className="mode-text">Code Modifications</div>
								</div>
								<div className="mode-item disabled">
									<div className="mode-icon plan-icon-disabled">
										<div className="line-icon disabled-line"></div>
									</div>
									<div className="mode-text">File Creation/Deletion</div>
								</div>
							</div>
						</div>

						{/* Act Mode Column */}
						<div className="act-mode-container">
							<div className="mode-header">
								<h3 className="mode-title">Act Mode</h3>
							</div>
							<div className="mode-content">
								<div className="mode-item">
									<div className="mode-icon act-icon">
										<div className="line-icon act-line"></div>
									</div>
									<div className="mode-text">Read files & Analysis</div>
								</div>
								<div className="mode-item">
									<div className="mode-icon act-icon">
										<div className="line-icon act-line"></div>
									</div>
									<div className="mode-text">Code Modifications</div>
								</div>
								<div className="mode-item">
									<div className="mode-icon act-icon">
										<div className="line-icon act-line"></div>
									</div>
									<div className="mode-text">File Creation/Deletion</div>
								</div>
								<div className="mode-item">
									<div className="mode-icon act-icon">
										<div className="line-icon act-line"></div>
									</div>
									<div className="mode-text">Execute Commands</div>
								</div>
								<div className="mode-item">
									<div className="mode-icon act-icon">
										<div className="line-icon act-line"></div>
									</div>
									<div className="mode-text">Run Tests</div>
								</div>
								<div className="mode-item">
									<div className="mode-icon act-icon">
										<div className="line-icon act-line"></div>
									</div>
									<div className="mode-text">Deploy Changes</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="divider"></div>

				{/* MCP Servers Section */}
				<div className="mcp-servers-container">
					<div className="mcp-content-container">
						<div className="mcp-text-container">
							<h2 className="mcp-heading">The largest ecosystem of MCP Servers for VS Code</h2>
							<p className="mcp-description">
								The Model Context Protocol (MCP) allows seamless communication with locally running servers that
								extend Cline's functionality with additional tools and context-aware resources.
							</p>
							<button className="mcp-button">Add an MCP Server</button>
						</div>
						<div className="mcp-count"></div>
					</div>
				</div>
			</div>
		</div>
	)
}

export default WelcomeTabView
