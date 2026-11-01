import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { BaseError, ContractFunctionRevertedError, erc20Abi, type Address, type Hash } from 'viem'
import { toast } from 'sonner'
import { CHAIN_ID, VAULT_ADDRESS } from '@/lib/vault'
import { buildTxExplorerUrl } from '@/onchain-facts'

export interface TxStep {
  label: string
  send: () => Promise<Hash>
  /** Resolves true when the step is unnecessary (for example, allowance already covers the amount). */
  skip?: () => Promise<boolean>
}

export type TxPhase = 'idle' | 'wallet' | 'confirming'

const ERROR_COPY: Record<string, string> = {
  NothingReleasable: 'Nothing has unlocked yet.',
  RefundNotAvailable: 'A refund is not available yet.',
  Unauthorized: 'This wallet is not allowed to do that.',
  AmountExceedsRemaining: 'That is more than what is left.',
  InvalidScheduleTiming: 'Those dates are not valid for a schedule.',
  InvalidBeneficiary: 'That recipient address is not allowed.',
  InvalidArbiter: 'The arbiter must be a different address.',
  InvalidDeadline: 'The deadline must be in the future.',
  ScheduleNotCancelable: 'This schedule was created as non-cancelable.',
  ScheduleAlreadyCancelled: 'This schedule is already cancelled.',
  MemoTooLong: 'The note is too long (140 characters max).',
  ZeroAmount: 'Enter an amount greater than zero.',
  LockupMustBeNonCancelable: 'Lockups cannot be cancelable.',
  InvalidToken: 'That address is not a token contract.',
  UnsupportedToken: 'This token charges a fee on transfer or changes balances, which Nodra does not support.',
  InvalidBatch: 'Check the payroll list: up to 100 valid recipients.',
}

/** Returns user-facing copy, or null when the user simply dismissed the wallet prompt. */
export function describeError(error: unknown): string | null {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) {
      return ERROR_COPY[reverted.data.errorName] ?? 'The contract rejected this transaction.'
    }
    if (error.name === 'UserRejectedRequestError' || /user rejected|user denied/i.test(error.message)) return null
    if (/insufficient funds|exceeds balance/i.test(error.message)) {
      return 'Not enough USDC for this transaction and its network fee.'
    }
    return error.shortMessage
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export function useVaultTx() {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<TxPhase>('idle')
  const [stepLabel, setStepLabel] = useState('')
  const [lastHash, setLastHash] = useState<Hash | undefined>()

  const approveStep = useCallback(
    (token: Address, amount: bigint, symbol = 'token'): TxStep => ({
      label: `Allow ${symbol}`,
      skip: async () => {
        if (!client || !address) return false
        const allowance = await client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, VAULT_ADDRESS],
        })
        return allowance >= amount
      },
      send: () =>
        writeContractAsync({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [VAULT_ADDRESS, amount],
          chainId: CHAIN_ID,
        }),
    }),
    [client, address, writeContractAsync],
  )

  const execute = useCallback(
    async (steps: TxStep[], successMessage: string): Promise<boolean> => {
      if (!client) return false
      let finalHash: Hash | undefined
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
        for (const step of steps) {
          if (step.skip && (await step.skip())) continue
          setStepLabel(step.label)
          setPhase('wallet')
          const hash = await step.send()
          setLastHash(hash)
          finalHash = hash
          setPhase('confirming')
          const receipt = await client.waitForTransactionReceipt({ hash })
          if (receipt.status !== 'success') throw new Error('The transaction was reverted onchain.')
        }
        const url = finalHash ? buildTxExplorerUrl(CHAIN_ID, finalHash) : undefined
        toast.success(successMessage, url ? { action: { label: 'View transaction', onClick: () => window.open(url, '_blank', 'noopener,noreferrer') } } : undefined)
        await queryClient.invalidateQueries()
        return true
      } catch (error) {
        const message = describeError(error)
        if (message) toast.error(message)
        return false
      } finally {
        setPhase('idle')
        setStepLabel('')
      }
    },
    [client, chainId, switchChainAsync, queryClient],
  )

  return { execute, approveStep, writeContractAsync, phase, stepLabel, lastHash, busy: phase !== 'idle' }
}
