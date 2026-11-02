import { arc, arcTestnet } from 'viem/chains'

/**
 * Which Arc network the app talks to. Defaults to testnet.
 * Set VITE_NETWORK=mainnet (with the mainnet vault address and deploy block) to switch.
 */
export const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet'
export const ARC_CHAIN = IS_MAINNET ? arc : arcTestnet
export const NETWORK_NAME = IS_MAINNET ? 'Arc' : 'Arc Testnet'

export const TAGLINE = 'Escrow and conditional payouts for businesses'
