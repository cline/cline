export const SPRITE_SIZE = 80
export const SHADOW_HEIGHT = SPRITE_SIZE / 8
export const SPRITE_SHEET_WIDTH = SPRITE_SIZE * 8

export type HedgehogSkin = 'default' | 'spiderhog'

export type SpriteInfo = {
    /** Number of frames in this sprite sheet */
    frames: number
    /** Path to the sprite sheet */
    img: string
    /** How many times to loop through the sprite sheet before stopping. If not set, will loop forever (so needs custom logic to decide when to end) */
    maxIteration?: number
    /** If set, will force the sprite to always face this direction */
    forceDirection?: 'left' | 'right'
    /** How likely this animation is to be chosen. Higher numbers are more likely. */
    randomChance?: number
    accessoryPositions?: [number, number][]
    filter?: string
    style?: React.CSSProperties
}

export const accessoryGroups = ['headwear', 'eyewear', 'other'] as const

export type AccessoryInfo = {
    /** Path to the img */
    img: string
    group: (typeof accessoryGroups)[number]
}

// If loaded via the toolbar the root domain won't be app.posthog.com and so the assets won't load
// Simple workaround is we detect if the domain is localhost and if not we just use https://us.posthog.com
const baseSpritePath = (): string => {
    let path = `/static/hedgehog/sprites`

    if (window.location.hostname !== 'localhost') {
        path = `https://us.posthog.com${path}`
    }

    return path
}
const baseSpriteAccessoriesPath = (): string => `${baseSpritePath()}/accessories`

export const spriteUrl = (skin: HedgehogSkin, img: string): string => {
    return `${baseSpritePath()}/skins/${skin}/${img}.png`
}

export const spriteOverlayUrl = (img: string): string => {
    return `${baseSpritePath()}/overlays/${img}.png`
}

export const spriteAccessoryUrl = (img: string): string => {
    return `${baseSpriteAccessoriesPath()}/${img}.png`
}

const animationsNames = ['stop', 'fall', 'jump', 'sign', 'walk', 'wave', 'flag', 'inspect', 'phone', 'action'] as const
export type AnimationName = (typeof animationsNames)[number]

const standardAnimations: Record<AnimationName, SpriteInfo> = {
    stop: {
        img: 'wave',
        frames: 1,
        maxIteration: 50,
        randomChance: 1,
    },
    fall: {
        img: 'fall',
        frames: 9,
        forceDirection: 'left',
        randomChance: 0,
    },
    jump: {
        img: 'jump',
        frames: 10,
        maxIteration: 10,
        randomChance: 2,
        accessoryPositions: [
            [0, 0],
            [0, 1],
            [0, 2],
            [0, 0],
            [0, -3],
            [0, -5],
            [0, -5],
            [0, -4],
            [0, -2],
            [0, -1],
        ],
    },
    sign: {
        img: 'sign',
        frames: 33,
        maxIteration: 1,
        forceDirection: 'right',
        randomChance: 1,
    },
    walk: {
        img: 'walk',
        frames: 11,
        maxIteration: 20,
        randomChance: 10,
    },
    wave: {
        img: 'wave',
        frames: 26,
        maxIteration: 1,
        randomChance: 2,
    },
    flag: {
        img: 'flag',
        frames: 25,
        maxIteration: 1,
        randomChance: 1,
    },
    inspect: {
        img: 'inspect',
        frames: 36,
        maxIteration: 1,
        randomChance: 1,
    },
    phone: {
        img: 'phone',
        frames: 28,
        maxIteration: 1,
        randomChance: 1,
    },
    action: {
        img: 'action',
        frames: 16,
        maxIteration: 3,
        randomChance: 1,
    },
}

const overlayAnimationsNames = ['fire'] as const

export type OverlayAnimationName = (typeof overlayAnimationsNames)[number]

export const overlayAnimations: Record<OverlayAnimationName, SpriteInfo> = {
    fire: {
        img: 'fire',
        frames: 14,
        maxIteration: 1,
        style: {
            opacity: 0.75,
        },
    },
}

export const standardAccessories: { [key: string]: AccessoryInfo } = {
    beret: {
        img: 'beret',
        group: 'headwear',
    },
    cap: {
        img: 'cap',
        group: 'headwear',
    },
    chef: {
        img: 'chef',
        group: 'headwear',
    },
    cowboy: {
        img: 'cowboy',
        group: 'headwear',
    },
    eyepatch: {
        img: 'eyepatch',
        group: 'eyewear',
    },
    flag: {
        img: 'flag',
        group: 'headwear',
    },
    glasses: {
        img: 'glasses',
        group: 'eyewear',
    },
    graduation: {
        img: 'graduation',
        group: 'headwear',
    },

    parrot: {
        img: 'parrot',
        group: 'other',
    },
    party: {
        img: 'party',
        group: 'headwear',
    },
    pineapple: {
        img: 'pineapple',
        group: 'headwear',
    },
    sunglasses: {
        img: 'sunglasses',
        group: 'eyewear',
    },
    tophat: {
        img: 'tophat',
        group: 'headwear',
    },
    xmas_hat: {
        img: 'xmas-hat',
        group: 'headwear',
    },
    xmas_antlers: {
        img: 'xmas-antlers',
        group: 'headwear',
    },
    xmas_scarf: {
        img: 'xmas-scarf',
        group: 'other',
    },
}

export const skins: Record<HedgehogSkin, { [key: string]: SpriteInfo }> = {
    default: standardAnimations,
    spiderhog: {
        stop: standardAnimations.stop,
        fall: standardAnimations.fall,
        jump: standardAnimations.jump,
        walk: standardAnimations.walk,
        wave: standardAnimations.wave,
    },
}
