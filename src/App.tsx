import { IS_MAINNET, NETWORK_NAME } from '@/lib/network'
import { useEffect, useState, type ComponentType } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount } from '@/hooks/useAccount'
import { AccountMenu } from '@/components/AccountMenu'
import { EmailSignIn } from '@/components/EmailSignIn'
import { useEmailWalletsEnabled } from '@/lib/api'
import { useSession } from '@/lib/session'
import { navigate, useRoute } from '@/hooks/useRoute'
import {
  Briefcase,
  CalendarClock,
  Coins,
  Droplets,
  ExternalLink,
  Gift,
  Hourglass,
  Landmark,
  LayoutDashboard,
  Lock,
  ShieldCheck,
  Users,
  Vault,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { Overview } from '@/components/Overview'
import { EscrowPage } from '@/components/EscrowPage'
import { SchedulePage } from '@/components/SchedulePage'
import { CreateEscrow } from '@/components/CreateEscrow'
import { CreateSchedule } from '@/components/CreateSchedule'
import { CreatePayroll } from '@/components/CreatePayroll'
import { WrongNetworkBanner } from '@/components/NetworkBar'
import { useNow, useUsdcBalance, useVaultData } from '@/hooks/useVaultData'
import { ActivityContext, useActivity } from '@/hooks/useActivity'
import { GROUP_LABEL, PLAN_BY_ID, PLAN_PAGES, type CreateKind, type NavGroup, type PageId, type PlanPage } from '@/lib/plans'
import { CHAIN_ID, VAULT_ADDRESS, fmtUsdc } from '@/lib/vault'
import { buildAddressExplorerUrl } from '@/onchain-facts'

type Icon = ComponentType<{ className?: string }>

const ICONS: Record<PageId, Icon> = {
  overview: LayoutDashboard,
  escrow: ShieldCheck,
  scheduled: CalendarClock,
  payroll: Users,
  vesting: Hourglass,
  grants: Gift,
  investor: Briefcase,
  claims: Coins,
  timelock: Lock,
  treasury: Landmark,
  lp: Droplets,
}

interface NavEntry {
  id: PageId
  label: string
  group?: NavGroup
}

const NAV: NavEntry[] = [
  { id: 'overview', label: 'Home' },
  { id: 'escrow', label: 'Escrow', group: 'payments' },
  ...PLAN_PAGES.map((p): NavEntry => ({ id: p.id, label: p.label, group: p.group })),
]
const GROUPS: NavGroup[] = ['payments', 'plans', 'locks']

export default function App() {
  const { address, isConnected } = useAccount()
  const { session } = useSession()
  const emailEnabled = useEmailWalletsEnabled()
  const [emailOpen, setEmailOpen] = useState(false)
  const { data, isLoading, isError } = useVaultData(address)
  const { data: balance } = useUsdcBalance()
  const activity = useActivity(address, data)
  const now = useNow(1000)
  const route = useRoute()
  const page: PageId = route.name === 'home' ? 'overview' : route.page
  const setPage = navigate
  const isHome = page === 'overview'
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [page])
  const [creating, setCreating] = useState<CreateKind | null>(null)
  const [schedulePlan, setSchedulePlan] = useState<PlanPage | null>(null)
  const [openCount, setOpenCount] = useState(0)

  // A new key per open gives each form fresh defaults (dates, empty fields) without effects.
  const startCreate = (kind: CreateKind) => {
    setOpenCount((n) => n + 1)
    if (kind !== 'escrow' && kind !== 'payroll') setSchedulePlan(PLAN_BY_ID[kind])
    setCreating(kind)
  }

  const escrows = data?.escrows ?? []
  const schedules = data?.schedules ?? []
  const counts = (id: PageId): number => {
    if (id === 'overview') return 0
    if (id === 'escrow') return escrows.length
    const kind = PLAN_BY_ID[id].kind
    return schedules.filter((s) => s.kind === kind).length
  }
  const loading = isConnected && isLoading
  const close = () => setCreating(null)

  const navButton = (n: NavEntry, compact: boolean) => {
    const Icon = ICONS[n.id]
    const count = counts(n.id)
    return (
      <button key={n.id} className={`nav-item ${compact ? 'w-auto shrink-0' : ''}`} aria-current={page === n.id ? 'page' : undefined} onClick={() => setPage(n.id)}>
        <Icon className="size-4 shrink-0" />
        <span className="whitespace-nowrap">{n.label}</span>
        {count > 0 && (
          <span className={`${compact ? '' : 'ml-auto'} rounded-full px-1.5 text-[11px] tabular-nums`} style={{ background: 'var(--chip)' }}>
            {count}
          </span>
        )}
      </button>
    )
  }

  const activePlan = page !== 'overview' && page !== 'escrow' ? PLAN_BY_ID[page] : null

  const accountControls = (
    <>
      {balance !== undefined && (
        <span className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold tabular-nums md:hidden" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
          <TokenUSDC variant="branded" size={14} /> {fmtUsdc(balance)}
        </span>
      )}
      {session ? (
        <AccountMenu />
      ) : (
        <>
          {emailEnabled && (
            <button className="btn btn-ghost btn-sm" onClick={() => setEmailOpen(true)}>
              Sign up with email
            </button>
          )}
          <ConnectKitButton showAvatar={false} />
        </>
      )}
    </>
  )

  const footer = (
    <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 pb-20 text-xs md:px-8" style={{ color: 'var(--subtle)' }}>
      <span>{IS_MAINNET ? 'Nodra runs on Arc mainnet. Transactions use real funds and cannot be undone.' : 'Nodra runs on Arc Testnet. Testnet tokens have no value.'}</span>
      <span className="flex flex-wrap items-center">
        <a className="inline-flex min-h-11 items-center px-2 hover:underline" href={buildAddressExplorerUrl(CHAIN_ID, VAULT_ADDRESS)} target="_blank" rel="noopener noreferrer">
          Contract
        </a>
        <a className="inline-flex min-h-11 items-center px-2 hover:underline" href="https://docs.arc.io" target="_blank" rel="noopener noreferrer">
          Arc docs
        </a>
      </span>
    </footer>
  )

  const overlays = (
    <>
      {emailEnabled && <EmailSignIn open={emailOpen} onClose={() => setEmailOpen(false)} />}
      <CreateEscrow key={`escrow-${openCount}`} open={creating === 'escrow'} onClose={close} />
      <CreatePayroll key={`payroll-${openCount}`} open={creating === 'payroll'} onClose={close} />
      {schedulePlan && <CreateSchedule key={`${schedulePlan.id}-${openCount}`} plan={schedulePlan} open={creating === schedulePlan.id} onClose={close} />}
    </>
  )

  const overview = (
    <Overview data={data} loading={loading} now={now} balance={balance} onOpen={setPage} onEmail={emailEnabled ? () => setEmailOpen(true) : undefined} />
  )

  if (isHome) {
    return (
      <div className="min-h-dvh">
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <a href="#/" className="flex items-center gap-2.5" aria-label="Nodra home">
            <span className="flex size-9 items-center justify-center rounded-xl" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
              <Vault className="size-5" />
            </span>
            <span className="display text-lg font-bold">Nodra</span>
          </a>
          <div className="flex items-center gap-2">
            <a href="#about" className="btn btn-ghost btn-sm">
              About
            </a>
            <button className="btn btn-ghost btn-sm" onClick={() => setPage('escrow')}>
              Open app
            </button>
            {accountControls}
          </div>
        </header>
        <ActivityContext.Provider value={activity.data}>
          <main className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-16 pt-2 md:px-8">
            <WrongNetworkBanner />
            {isError && (
              <p className="text-sm" style={{ color: 'var(--danger)' }}>
                Could not load your payouts. Check your connection and try again.
              </p>
            )}
            {overview}
          </main>
        </ActivityContext.Provider>
        {footer}
        {overlays}
      </div>
    )
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[256px_1fr]">
      <aside
        className="sticky top-0 hidden h-dvh flex-col gap-4 overflow-y-auto border-r p-4 md:flex"
        style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.78)', backdropFilter: 'blur(12px)' }}
      >
        <a href="#/" className="flex items-center gap-2.5 px-1 pt-1" aria-label="Nodra home">
          <div className="flex size-9 items-center justify-center rounded-xl" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
            <Vault className="size-5" />
          </div>
          <div>
            <p className="display text-lg font-bold leading-none">Nodra</p>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
              {NETWORK_NAME}
            </p>
          </div>
        </a>
        <nav className="space-y-4" aria-label="Sections">
          <div>{navButton(NAV[0], false)}</div>
          {GROUPS.map((g) => (
            <div key={g} className="space-y-0.5">
              <p className="eyebrow px-3 pb-1">{GROUP_LABEL[g]}</p>
              {NAV.filter((n) => n.group === g).map((n) => navButton(n, false))}
            </div>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          {isConnected && (
            <div className="inner p-3.5">
              <p className="eyebrow">USDC balance</p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold tabular-nums">
                <TokenUSDC variant="branded" size={20} /> {balance === undefined ? '...' : fmtUsdc(balance)}
              </p>
              {balance === 0n && (
                <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                  Use Get test USDC in the Arc Studio sidebar to fund this wallet.
                </p>
              )}
            </div>
          )}
          <a
            href={buildAddressExplorerUrl(CHAIN_ID, VAULT_ADDRESS)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 px-1 text-xs font-medium"
            style={{ color: 'var(--muted)' }}
          >
            Vault contract <ExternalLink className="size-3" />
          </a>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div className="flex items-center gap-2.5 md:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
              <Vault className="size-4" />
            </div>
            <p className="display text-base font-bold">Nodra</p>
          </div>
          <div className="ml-auto flex items-center gap-2">{accountControls}</div>
        </header>

        <nav className="flex gap-1 overflow-x-auto px-4 pb-3 md:hidden" aria-label="Sections">
          {NAV.map((n) => navButton(n, true))}
        </nav>

        <ActivityContext.Provider value={activity.data}>
        <main className="mx-auto w-full max-w-5xl space-y-5 px-4 pb-24 pt-2 md:px-8">
          <WrongNetworkBanner />
          {isError && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              Could not load your payouts. Check your connection and try again.
            </p>
          )}
          {page === 'escrow' && <EscrowPage escrows={escrows} loading={loading} now={now} onNew={() => startCreate('escrow')} />}
          {activePlan && <SchedulePage key={activePlan.id} kind={activePlan.kind} schedules={schedules} loading={loading} now={now} onNew={() => startCreate(activePlan.id)} />}
        </main>
        </ActivityContext.Provider>
        {footer}
      </div>

      {overlays}
    </div>
  )
}
