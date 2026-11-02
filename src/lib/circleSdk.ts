import type { W3SSdk } from '@circle-fin/w3s-pw-web-sdk'
import { CIRCLE_APP_ID, circleCall } from '@/lib/api'

export interface LoginResult {
  userToken: string
  encryptionKey: string
}

let sdk: W3SSdk | null = null
let pendingLogin: { resolve: (r: LoginResult) => void; reject: (e: Error) => void } | null = null

/** Loads Circle's web SDK on first use so it stays out of the main bundle. */
export async function getSdk(): Promise<W3SSdk> {
  if (sdk) return sdk
  if (!CIRCLE_APP_ID) throw new Error('Email sign-in is not set up yet.')
  const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk')
  sdk = new W3SSdk({ appSettings: { appId: CIRCLE_APP_ID } }, (error, result) => {
    const waiting = pendingLogin
    pendingLogin = null
    if (!waiting) return
    if (error || !result?.userToken || !result.encryptionKey) {
      waiting.reject(new Error((error as { message?: string } | undefined)?.message ?? 'Email verification did not finish.'))
      return
    }
    waiting.resolve({ userToken: result.userToken, encryptionKey: result.encryptionKey })
  })
  return sdk
}

/** Step 1: ask Circle to email a one-time code. */
export async function requestEmailCode(email: string): Promise<void> {
  if (!CIRCLE_APP_ID) throw new Error('Email sign-in is not set up yet.')
  const s = await getSdk()
  const deviceId = await s.getDeviceId()
  const session = await circleCall<{ deviceToken: string; deviceEncryptionKey: string; otpToken: string }>('requestEmailOtp', { deviceId, email })
  s.updateConfigs({
    appSettings: { appId: CIRCLE_APP_ID },
    loginConfigs: { deviceToken: session.deviceToken, deviceEncryptionKey: session.deviceEncryptionKey, otpToken: session.otpToken },
  })
}

/** Step 2: Circle's hosted window collects the code and returns the user's tokens. */
export async function verifyEmailCode(): Promise<LoginResult> {
  const s = await getSdk()
  return new Promise<LoginResult>((resolve, reject) => {
    pendingLogin = { resolve, reject }
    s.verifyOtp()
  })
}

/** Runs a Circle challenge (PIN setup or a transaction approval) in Circle's hosted window. */
export async function runChallenge(auth: LoginResult, challengeId: string): Promise<void> {
  const s = await getSdk()
  s.setAuthentication({ userToken: auth.userToken, encryptionKey: auth.encryptionKey })
  return new Promise<void>((resolve, reject) => {
    s.execute(challengeId, (error) => {
      if (error) reject(new Error((error as { message?: string }).message ?? 'The approval was cancelled.'))
      else resolve()
    })
  })
}
