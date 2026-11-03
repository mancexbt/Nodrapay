# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Nodra: USDC escrow (arbiter, milestone releases), scheduled payouts, payroll batches and vesting grants on Arc Testnet.

Deployed contracts:
- PayoutVault v3 (Arc Testnet): 0x26683ecfdade1983bb57482113fc883f0dc737d0 (adds escrow milestones, claimEscrow, one-time dispute with 30-day window, extendSchedule for payroll; createEscrow takes a 7th milestones argument), no constructor args; any ERC-20 per escrow/schedule (exact-transfer, non-rebasing). Kinds: Scheduled, Payroll, Vesting, InvestorLockup, Claim, Grant, TreasuryLockup, TimeLock, LPLockup (the four lockups cannot be cancelable). Address and deploy block are read from `VITE_PAYOUT_VAULT_ADDRESS` / `VITE_PAYOUT_VAULT_DEPLOY_BLOCK` in `.env`. ABI is generated into `src/contracts/payoutVault.ts`; regenerate after any contract change. Superseded: v2 0xd4192223725c5553238a14e52792f40c9f10b663, v1 0xdff8949528cbf30781118cbcdeac19422b7252af (plans created on them are not shown).
- No owner or admin; funds only move through escrow/schedule rules. Reviewed (balanced), 204 unit tests plus invariants pass. Known design choice: depositor refund window opens before the recipient claim window.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```

- Arc mainnet vault (deployed by the user via Remix): 0x75b26d58e7c62777f34cd0a4be7884ebec485e8e, block 29062486. Config in .env.mainnet; the dev server and Netlify site stay on Arc Testnet.
- The project .env now targets Arc mainnet (VITE_NETWORK=mainnet). Testnet values are in .env.testnet. The Netlify site (nodrapay.netlify.app) was built from the testnet config and has not been changed.
- Email sign-up and alerts: server in server/ (bun run server, port 8787), Vite proxies /api. Circle user-controlled wallets (email OTP, SCA, ARC-TESTNET only; hidden on mainnet). Needs VITE_CIRCLE_APP_ID in .env and SMTP configured in the Circle Console. Alerts need SMTP_* in .env (or ALERTS_DRY_RUN=1). Email session tokens are kept in memory only. The server only forwards vault calls and vault-spender approvals. The dev preview is run with `--mode testnet` so the email option is visible; .env still targets mainnet.
- Three-page layout with hash routing (src/hooks/useRoute.ts): #/ is the front page (src/components/Overview.tsx), #/about is the About page (Get started + About, src/components/AboutPage.tsx), #/app/<section> is the app with the sidebar.
- Token grants, investor lockups, token claims, time locks and LP lockups are hidden from the UI (HIDDEN_PLANS in src/lib/plans.ts). The contract still supports them; remove the id from that set to bring one back.
