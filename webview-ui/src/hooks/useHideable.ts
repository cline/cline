import { useToggle } from "react-use"

export const useHideable = (defaultVisible: boolean = true) => {
    const [visible, toggle] = useToggle(defaultVisible)
    const hide = () => toggle(false)
    const show = () => toggle(true)
    return [ visible, hide, show ] as [boolean, () => void, () => void]
}