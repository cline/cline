import { ArrowLeftOutlined, BugOutlined } from "@ant-design/icons"
import { Button, Card, Space, Typography } from "antd"
import React from "react"

const { Title, Text } = Typography

interface UdsDiagViewProps {
	onBack?: () => void
}

const UdsDiagView: React.FC<UdsDiagViewProps> = ({ onBack }) => {
	return (
		<div style={{ padding: "20px", height: "100%", display: "flex", flexDirection: "column" }}>
			<Card
				bodyStyle={{
					flex: 1,
					overflow: "auto",
					backgroundColor: "var(--vscode-sideBar-background)",
				}}
				style={{
					height: "100%",
					display: "flex",
					flexDirection: "column",
					backgroundColor: "var(--vscode-sideBar-background)",
					borderColor: "var(--vscode-panel-border)",
				}}>
				<Space direction="vertical" size="large" style={{ width: "100%" }}>
					<div>
						{onBack && (
							<Button
								icon={<ArrowLeftOutlined />}
								onClick={onBack}
								style={{
									marginBottom: "12px",
									color: "var(--vscode-textLink-foreground)",
								}}
								type="text">
								返回菜单
							</Button>
						)}
						<Title
							level={3}
							style={{
								color: "var(--vscode-foreground)",
								display: "flex",
								alignItems: "center",
								gap: "8px",
							}}>
							<BugOutlined />
							UDS诊断
						</Title>
						<Text style={{ color: "var(--vscode-descriptionForeground)" }}>
							UDS (Unified Diagnostic Services) 诊断工具
						</Text>
					</div>

					<div
						style={{
							backgroundColor: "var(--vscode-editor-background)",
							padding: "16px",
							borderRadius: "4px",
							border: "1px solid var(--vscode-panel-border)",
						}}>
						<Text style={{ color: "var(--vscode-foreground)" }}>
							在这里将实现UDS诊断功能：
							<ul style={{ color: "var(--vscode-foreground)", marginTop: "8px", paddingLeft: "20px" }}>
								<li>连接ECU设备</li>
								<li>发送UDS诊断请求</li>
								<li>解析诊断响应</li>
								<li>显示诊断信息</li>
								<li>执行诊断服务（如读取DTC、清除故障码等）</li>
							</ul>
						</Text>
					</div>
				</Space>
			</Card>
		</div>
	)
}

export default UdsDiagView
