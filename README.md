# Nodra

Escrow and conditional payouts for USDC on Arc (other ERC-20 tokens work too), plus payroll, vesting and lockups: lock funds for someone and release them when work is approved, schedule payouts, run payroll, vest tokens to your team, and lock investor allocations, treasuries and LP tokens.

Built with [Arc Studio](https://studio.arc.io)

## Features

- Two pages: a front page with the overview and a get-started guide, and the app with escrow, payroll, vesting, lockups and claims
- Escrow with named milestones (custom amounts or one total split evenly), an optional arbiter, partial releases, and refunds after a deadline
- Recipient claim: if nobody releases or refunds after the deadline and a grace period, the recipient can claim what is left
- One dispute per escrow, which pauses the recipient's claim for 30 days without freezing the funds
- An "Needs your action" list on the Overview for releases to review and payments to claim
- Scheduled payouts that unlock at a time you choose
- Email sign-up (Arc Testnet): get a wallet with just an email and a PIN, no browser wallet needed
- Email alerts: opt in to an email when a payment unlocks, a plan is set up for you, or an escrow needs action (double opt-in, one-click unsubscribe)
- Payroll: fund a whole team once and pay every period, with custom amounts or one total split evenly; extend a run with more periods and see its payment history
- Vesting plans and token grants that unlock continuously, with an optional cliff and quick presets
- Investor lockups, treasury lockups, time locks and LP lockups that nobody can cancel
- Token claims: set tokens aside for someone to claim, and take back what is unclaimed
- Works with USDC or any standard ERC-20 token (fee-on-transfer and rebasing tokens are not supported)
- Cancelable or locked-in schedules; recipients can send a payment to another wallet
- Overview with what is claimable now, what is coming up, and recent activity; plan pages with sortable incoming/outgoing tables with search, and a detail drawer per plan
- Recent activity feed read from onchain events, with links to each transaction
- Getting-started checklist and a prompt to switch networks
- Sort plans and export them to CSV
- Unlock-curve preview while you create a payout, payroll run or vesting grant

## Tech stack

- React, Vite, TypeScript, Tailwind CSS
- wagmi, viem, ConnectKit
- Solidity 0.8.28 with Foundry and OpenZeppelin

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://book.getfoundry.sh).

```bash
bun install
bun run dev
bun run server   # API for email sign-in and alerts (port 8787)
```

Contracts:

```bash
bun run contracts:build
bun run contracts:test
```

### Environment variables

- `VITE_PAYOUT_VAULT_ADDRESS`: address of the deployed PayoutVault contract on the selected network.
- `VITE_PAYOUT_VAULT_DEPLOY_BLOCK`: block the contract was deployed at; the activity feed reads events from here.
- `VITE_NETWORK`: `mainnet` runs against Arc mainnet (the current `.env` default); `testnet` or unset runs against Arc Testnet. `.env.testnet` holds the testnet values (`bun run build:testnet`). See `docs/mainnet-deploy.md`. `bun run build:mainnet` builds against Arc mainnet using `.env.mainnet`.
- `VITE_CIRCLE_APP_ID`: your Circle App ID (Wallets > User Controlled > Configurator). Turns on "Sign in with email" on Arc Testnet.
- `VITE_API_BASE_URL`: where the Nodra API server is hosted. Leave empty in development, where Vite forwards `/api` to the local server.
- `CIRCLE_API_KEY`: Circle API key, read only by the server in `server/`. Never expose it in the browser.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: mail server used to send alert emails. Without them alerts stay off.
- `ALERTS_PUBLIC_URL`: public address of the server, used in alert confirmation and unsubscribe links.
- `ALERTS_DRY_RUN`: set to `1` to print alert emails to the server log instead of sending them (for testing).
- `API_PORT`: port for the API server (default 8787).
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: provisioned by Arc Studio; optional outside Arc Studio.

Test USDC for Arc Testnet comes from the Circle faucet.
