import type { DatePickerProps } from "antd"
import { Button, Card, DatePicker, Input, Select, Space, Switch, Typography } from "antd"
import React, { useState } from "react"

const { Title, Text } = Typography
const { Option } = Select

const AntdExample: React.FC = () => {
	const [loading, setLoading] = useState(false)
	const [inputValue, setInputValue] = useState("")
	const [switchChecked, setSwitchChecked] = useState(false)
	const [selectedDate, setSelectedDate] = useState<DatePickerProps["value"]>(null)
	const [selectedOption, setSelectedOption] = useState<string | undefined>(undefined)

	const handleClick = () => {
		setLoading(true)
		setTimeout(() => {
			setLoading(false)
		}, 2000)
	}

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setInputValue(e.target.value)
	}

	const handleDateChange: DatePickerProps["onChange"] = (date, dateString) => {
		console.log(date, dateString)
		setSelectedDate(date)
	}

	const handleSelectChange = (value: string) => {
		console.log(`Selected: ${value}`)
		setSelectedOption(value)
	}

	const handleSwitchChange = (checked: boolean) => {
		console.log(`Switch to ${checked}`)
		setSwitchChecked(checked)
	}

	return (
		<div className="p-4">
			<Card style={{ maxWidth: 600, margin: "0 auto" }} title="Ant Design 组件示例">
				<Space direction="vertical" size="large" style={{ width: "100%" }}>
					<div>
						<Title level={4}>按钮组件</Title>
						<Space>
							<Button type="primary">Primary Button</Button>
							<Button>Default Button</Button>
							<Button type="dashed">Dashed Button</Button>
							<Button type="link">Link Button</Button>
							<Button loading={loading} onClick={handleClick} type="primary">
								Click me!
							</Button>
						</Space>
					</div>

					<div>
						<Title level={4}>输入组件</Title>
						<Space direction="vertical" style={{ width: "100%" }}>
							<Input onChange={handleInputChange} placeholder="请输入文本" value={inputValue} />
							<Text>输入的值: {inputValue}</Text>
						</Space>
					</div>

					<div>
						<Title level={4}>日期选择器</Title>
						<DatePicker onChange={handleDateChange} placeholder="请选择日期" value={selectedDate} />
					</div>

					<div>
						<Title level={4}>下拉选择</Title>
						<Select
							onChange={handleSelectChange}
							placeholder="请选择选项"
							style={{ width: 200 }}
							value={selectedOption}>
							<Option value="option1">选项 1</Option>
							<Option value="option2">选项 2</Option>
							<Option value="option3">选项 3</Option>
						</Select>
					</div>

					<div>
						<Title level={4}>开关</Title>
						<Space>
							<Switch checked={switchChecked} onChange={handleSwitchChange} />
							<Text>开关状态: {switchChecked ? "开启" : "关闭"}</Text>
						</Space>
					</div>
				</Space>
			</Card>
		</div>
	)
}

export default AntdExample
