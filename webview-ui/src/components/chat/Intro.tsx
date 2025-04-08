import { useMemo } from 'react'
import { useExtensionState } from '../../context/ExtensionStateContext'
import { HedgehogBuddy } from '../HedgehogBuddy.tsx/HedgehogBuddy'
import { uuid } from '../../utils/utils'

const HEADLINES = [
    'How can I help you build?',
    'What are we building today?',
    'What are you curious about?',
    'How can I help you understand users?',
    'What do you want to know today?',
]
const Intro = () => {
    const { currentTaskItem } = useExtensionState()

    const headline = useMemo(() => {
        return HEADLINES[parseInt((currentTaskItem?.id || uuid()).split('-').at(-1) as string, 16) % HEADLINES.length]
    }, [currentTaskItem?.id])
    return (
        <>
            <div className="flex items-center justify-center">
                <HedgehogBuddy
                    static
                    hedgehogConfig={{
                        enabled: true,
                        color: null,
                        accessories: [],
                        interactions_enabled: false,
                        controls_enabled: false,
                        party_mode_enabled: false,
                        walking_enabled: false,
                        use_as_profile: false,
                    }}
                    onClick={(actor) => {
                        if (Math.random() < 0.01) {
                            actor.setOnFire()
                        } else {
                            actor.setRandomAnimation()
                        }
                    }}
                    onActorLoaded={(actor) =>
                        setTimeout(() => {
                            actor.setAnimation('wave')
                            // Make the hedeghog face left, which looks better in the side panel
                            actor.direction = 'left'
                        }, 100)
                    }
                />
            </div>
            <div style={{ padding: '0 20px', flexShrink: 0 }}>
                <h2>{headline}</h2>
                <p>
                    I'm Max, here to help you build a successful product. I can help you write code and respond to
                    questions about your product and users.
                </p>
            </div>
        </>
    )
}

export default Intro
