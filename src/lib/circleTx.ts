import type { Address, Hash, Hex } from 'viem'
import { ApiRequestError, circleCall } from '@/lib/api'
import { runChallenge } from '@/lib/circleSdk'
import type { EmailSession } from '@/lib/session'
import { waitForSuccessfulTransaction } from '@/onchain-wait'

interface CircleTx {
  id: string
  state: string
  txHash?: string
  createDate: string
  contractAddress?: string
  destinationAddress?: string
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Your email session expired. Sign in again.')
    this.name = 'SessionExpiredError'
  }
}

/**
 * Sends one contract call from an email wallet: the server creates a challenge,
 * the user approves it in Circle's window, and we wait for Circle to finish it.
 * Returns the onchain transaction hash.
 */
export async function sendViaCircle(session: EmailSession, to: Address, callData: Hex): Promise<Hash> {
  const startedAt = Date.now() - 10_000
  try {
    const { challengeId } = await circleCall<{ challengeId: string }>('contractExecution', {
      userToken: session.userToken,
      walletId: session.walletId,
      contractAddress: to,
      callData,
    })
    await runChallenge(session, challengeId)
    const tx = await waitForSuccessfulTransaction(
      async () => {
        const { transactions } = await circleCall<{ transactions: CircleTx[] }>('listTransactions', { userToken: session.userToken, walletId: session.walletId })
        return transactions
          .filter((t) => Date.parse(t.createDate) >= startedAt && (t.contractAddress ?? t.destinationAddress)?.toLowerCase() === to.toLowerCase())
          .sort((a, b) => Date.parse(b.createDate) - Date.parse(a.createDate))[0]
      },
      (t) => t?.state,
      { label: 'Transaction' },
    )
    if (!tx?.txHash) throw new Error('Circle finished the transaction but did not return its hash.')
    return tx.txHash as Hash
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === 155104) throw new SessionExpiredError()
    throw error
  }
}
