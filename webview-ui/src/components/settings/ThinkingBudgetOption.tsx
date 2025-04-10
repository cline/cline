import { memo, useState } from 'react'
import { ApiConfiguration } from '../../../../src/shared/api'
import { VSCodeCheckbox } from '@vscode/webview-ui-toolkit/react'
import styled from 'styled-components'

// Styled Components
const Container = styled.div`
    display: flex;
    flex-direction: column;
    gap: 10px;
`

interface ThinkingBudgetOptionProps {
    apiConfiguration: ApiConfiguration | undefined
    setApiConfiguration: (apiConfiguration: ApiConfiguration) => void
}

const ThinkingBudgetSlider = ({ apiConfiguration, setApiConfiguration }: ThinkingBudgetOptionProps) => {
    const isEnabled = apiConfiguration?.thinkingEnabled

    // Add local state for the slider value
    const [localValue, setLocalValue] = useState(apiConfiguration?.thinkingEnabled)

    const handleToggleChange = (event: any) => {
        const isChecked = (event.target as HTMLInputElement).checked
        setLocalValue(isChecked)
        setApiConfiguration({
            ...apiConfiguration,
            thinkingEnabled: isChecked,
        })
    }

    return (
        <Container>
            <VSCodeCheckbox checked={isEnabled} onChange={handleToggleChange}>
                Enable extended thinking
            </VSCodeCheckbox>
        </Container>
    )
}

export default memo(ThinkingBudgetSlider)
