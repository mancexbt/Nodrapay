import type { DurationUnitId, KindId } from '@/lib/vault'

export type PageId =
  | 'overview'
  | 'escrow'
  | 'scheduled'
  | 'payroll'
  | 'vesting'
  | 'grants'
  | 'investor'
  | 'claims'
  | 'timelock'
  | 'treasury'
  | 'lp'

export type CreateKind = Exclude<PageId, 'overview'>
export type FormMode = 'point' | 'vesting' | 'instant'
export type NavGroup = 'payments' | 'plans' | 'locks'

export interface Preset {
  label: string
  cliff: [string, DurationUnitId]
  duration: [string, DurationUnitId]
}

export interface PlanPage {
  id: Exclude<PageId, 'overview' | 'escrow'>
  kind: KindId
  group: NavGroup
  label: string
  title: string
  blurb: string
  cta: string
  emptyTitle: string
  emptyBody: string
  form: {
    mode: FormMode
    lockup: boolean
    defaultCancelable: boolean
    defaultSelf: boolean
    title: string
    intro: string
    recipientLabel: string
    tokenLabel: string
    tokenRequired: boolean
    tokenHint?: string
    cta: string
    success: string
    presets: Preset[]
  }
}

const VESTING_PRESETS: Preset[] = [
  { label: '4 years, 1 year cliff', cliff: ['1', 'years'], duration: ['4', 'years'] },
  { label: '2 years, 6 month cliff', cliff: ['6', 'months'], duration: ['2', 'years'] },
  { label: '1 year, no cliff', cliff: ['', 'months'], duration: ['1', 'years'] },
]

export const GROUP_LABEL: Record<NavGroup, string> = {
  payments: 'Escrow & payouts',
  plans: 'Token plans',
  locks: 'Locks',
}

export const PLAN_PAGES: PlanPage[] = [
  {
    id: 'scheduled',
    kind: 0,
    group: 'payments',
    label: 'Scheduled',
    title: 'Scheduled payouts',
    blurb: 'Lock funds now and pay out at a set time.',
    cta: 'Schedule payout',
    emptyTitle: 'Nothing scheduled',
    emptyBody: 'Set aside a bonus, rent or invoice payment that unlocks on the date you choose.',
    form: {
      mode: 'point',
      lockup: false,
      defaultCancelable: true,
      defaultSelf: false,
      title: 'Schedule a payout',
      intro: 'Lock tokens now and let them pay out in one piece at the time you choose. The recipient (or anyone) can trigger the payout once it unlocks.',
      recipientLabel: 'Recipient',
      tokenLabel: 'Token',
      tokenRequired: false,
      cta: 'Lock and schedule',
      success: 'Payout scheduled.',
      presets: [],
    },
  },
  {
    id: 'payroll',
    kind: 1,
    group: 'payments',
    label: 'Payroll',
    title: 'Payroll',
    blurb: 'Fund a team once and pay every period.',
    cta: 'Fund payroll',
    emptyTitle: 'No payroll runs',
    emptyBody: 'Add your team, pick a cadence, and lock the whole run up front.',
    form: {
      mode: 'vesting',
      lockup: false,
      defaultCancelable: true,
      defaultSelf: false,
      title: 'Fund payroll',
      intro: '',
      recipientLabel: 'Recipient',
      tokenLabel: 'Token',
      tokenRequired: false,
      cta: 'Lock funds and start payroll',
      success: 'Payroll funded.',
      presets: [],
    },
  },
  {
    id: 'vesting',
    kind: 2,
    group: 'plans',
    label: 'Vesting plans',
    title: 'Vesting plans',
    blurb: 'Tokens that unlock gradually for your team, with an optional cliff.',
    cta: 'New vesting plan',
    emptyTitle: 'No vesting plans',
    emptyBody: 'Give employees or contributors tokens that unlock second by second, optionally after a cliff.',
    form: {
      mode: 'vesting',
      lockup: false,
      defaultCancelable: true,
      defaultSelf: false,
      title: 'New vesting plan',
      intro: 'Lock tokens that unlock continuously to a recipient, with an optional cliff before anything unlocks. You can revoke the unvested part if you keep it revocable.',
      recipientLabel: 'Recipient',
      tokenLabel: 'Token',
      tokenRequired: false,
      cta: 'Lock and start vesting',
      success: 'Vesting plan created.',
      presets: VESTING_PRESETS,
    },
  },
  {
    id: 'grants',
    kind: 5,
    group: 'plans',
    label: 'Token grants',
    title: 'Token grants',
    blurb: 'Reward contributors, advisors and community members over time.',
    cta: 'New token grant',
    emptyTitle: 'No token grants',
    emptyBody: 'Grant tokens to a contributor or advisor and let them vest after a cliff.',
    form: {
      mode: 'vesting',
      lockup: false,
      defaultCancelable: true,
      defaultSelf: false,
      title: 'New token grant',
      intro: 'Grant tokens that vest to a contributor over time. Keep it revocable if the grant depends on continued work.',
      recipientLabel: 'Grantee',
      tokenLabel: 'Token',
      tokenRequired: false,
      cta: 'Lock and grant',
      success: 'Token grant created.',
      presets: VESTING_PRESETS,
    },
  },
  {
    id: 'investor',
    kind: 3,
    group: 'plans',
    label: 'Investor lockups',
    title: 'Investor lockups',
    blurb: 'Locked-in allocations for investors, released on a fixed schedule.',
    cta: 'New investor lockup',
    emptyTitle: 'No investor lockups',
    emptyBody: 'Lock an investor allocation with a cliff and a release period. Nobody can cancel it once it is created.',
    form: {
      mode: 'vesting',
      lockup: true,
      defaultCancelable: false,
      defaultSelf: false,
      title: 'New investor lockup',
      intro: 'Lock an investor allocation that releases over time. Lockups cannot be cancelled by either side, which is what makes them credible.',
      recipientLabel: 'Investor wallet',
      tokenLabel: 'Token',
      tokenRequired: false,
      cta: 'Lock allocation',
      success: 'Investor lockup created.',
      presets: VESTING_PRESETS,
    },
  },
  {
    id: 'claims',
    kind: 4,
    group: 'plans',
    label: 'Token claims',
    title: 'Token claims',
    blurb: 'Make tokens available for someone to claim, and take back what is unclaimed.',
    cta: 'New token claim',
    emptyTitle: 'No token claims',
    emptyBody: 'Set aside tokens for a person or partner. They claim when ready, and you can reclaim them if they never do.',
    form: {
      mode: 'instant',
      lockup: false,
      defaultCancelable: true,
      defaultSelf: false,
      title: 'New token claim',
      intro: 'Set tokens aside that the recipient can claim right away. If you leave it cancelable, you can take back anything they have not claimed.',
      recipientLabel: 'Who can claim',
      tokenLabel: 'Token',
      tokenRequired: false,
      cta: 'Make claimable',
      success: 'Claim created.',
      presets: [],
    },
  },
  {
    id: 'timelock',
    kind: 7,
    group: 'locks',
    label: 'Time locks',
    title: 'Time locks',
    blurb: 'Lock tokens until a date. Nobody can touch them before then.',
    cta: 'New time lock',
    emptyTitle: 'No time locks',
    emptyBody: 'Prove commitment by locking tokens until a date you choose. They can only be released after it passes.',
    form: {
      mode: 'point',
      lockup: true,
      defaultCancelable: false,
      defaultSelf: true,
      title: 'New time lock',
      intro: 'Lock tokens until a date. Once locked they cannot be cancelled or moved, only released after the unlock time.',
      recipientLabel: 'Who receives them at unlock',
      tokenLabel: 'Token',
      tokenRequired: false,
      cta: 'Lock until date',
      success: 'Time lock created.',
      presets: [],
    },
  },
  {
    id: 'treasury',
    kind: 6,
    group: 'locks',
    label: 'Treasury lockups',
    title: 'Treasury lockups',
    blurb: 'Release a treasury to your team wallet on a fixed schedule.',
    cta: 'New treasury lockup',
    emptyTitle: 'No treasury lockups',
    emptyBody: 'Lock reserve funds and release them to your treasury wallet gradually, so spending follows a public plan.',
    form: {
      mode: 'vesting',
      lockup: true,
      defaultCancelable: false,
      defaultSelf: false,
      title: 'New treasury lockup',
      intro: 'Lock reserve funds that release gradually to a treasury wallet. The schedule is public and cannot be changed or cancelled.',
      recipientLabel: 'Treasury wallet',
      tokenLabel: 'Token',
      tokenRequired: false,
      cta: 'Lock treasury funds',
      success: 'Treasury lockup created.',
      presets: VESTING_PRESETS,
    },
  },
  {
    id: 'lp',
    kind: 8,
    group: 'locks',
    label: 'LP lockups',
    title: 'LP lockups',
    blurb: 'Lock liquidity-provider tokens to show liquidity will stay put.',
    cta: 'New LP lockup',
    emptyTitle: 'No LP lockups',
    emptyBody: 'Lock LP tokens until a date so your community can see the liquidity is committed.',
    form: {
      mode: 'point',
      lockup: true,
      defaultCancelable: false,
      defaultSelf: true,
      title: 'New LP lockup',
      intro: 'Lock liquidity-provider tokens until a date. They cannot be cancelled, and can only be released to the recipient after the unlock time.',
      recipientLabel: 'Who receives them at unlock',
      tokenLabel: 'LP token address',
      tokenRequired: true,
      tokenHint: 'Paste the LP token (ERC-20) contract address. NFT-based liquidity positions are not supported.',
      cta: 'Lock LP tokens',
      success: 'LP lockup created.',
      presets: [],
    },
  },
]

export const PLAN_BY_ID = Object.fromEntries(PLAN_PAGES.map((p) => [p.id, p])) as Record<PlanPage['id'], PlanPage>
export const PLAN_BY_KIND = Object.fromEntries(PLAN_PAGES.map((p) => [p.kind, p])) as Record<KindId, PlanPage>
