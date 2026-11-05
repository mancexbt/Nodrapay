# Deploying Nodra to Arc mainnet (you run this yourself)

Arc Studio does not deploy to, sign for, or fund anything on mainnet. These steps are for you to run
from your own machine and wallet. Real funds are involved and transactions cannot be undone.

## Before you start
- Get an independent professional audit of `contracts/PayoutVault.sol`. It has no admin, no upgrade path
  and no pause, so a mistake after deployment cannot be fixed.
- Confirm the Arc mainnet EVM version supports the compiler settings in `foundry.toml` (Cancun, solc 0.8.28).
- Use a dedicated deployer wallet funded with a small amount of USDC (USDC is the gas token on Arc).
- Never paste a private key into a file, chat or commit. Keep it in a shell variable only.

## 1. Build
```bash
forge build
```

## 2. Deploy the contract (no constructor arguments)
```bash
export PRIVATE_KEY=<your deployer key, shell only>
forge create contracts/PayoutVault.sol:PayoutVault \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $PRIVATE_KEY \
  --broadcast
```
Note the "Deployed to" address and the transaction hash.

## 3. Find the deployment block
```bash
cast receipt <TX_HASH> blockNumber --rpc-url https://rpc.mainnet.arc.io
```

## 4. Check the deployment
- Open the address on https://explorer.arc.io and confirm the code is present.
- Compare the deployed bytecode with `contracts/out/PayoutVault.sol/PayoutVault.json` (`cast code <ADDRESS>`).
- Try a very small escrow first.

## 5. Point the app at mainnet
Set these environment variables for the build (do not reuse the testnet values):
```
VITE_NETWORK=mainnet
VITE_PAYOUT_VAULT_ADDRESS=<mainnet vault address>
VITE_PAYOUT_VAULT_DEPLOY_BLOCK=<block from step 3>
```
Then `bun run build` and host the `dist/` folder yourself. With `VITE_NETWORK` unset the app stays on Arc Testnet.

## Alternative: deploy with Remix
Use `docs/PayoutVault.remix.sol` (the same contract with the OpenZeppelin imports pinned to 5.6.1).
In Remix, compile with solc 0.8.28, EVM version `cancun`, optimizer on with 200 runs, then deploy with
"Injected Provider" connected to Arc mainnet (chain ID 5042) and no constructor arguments.

## Your mainnet deployment (recorded)
- Network: Arc mainnet (chain ID 5042)
- Contract: `0x6ae2b887501bacA2400b62DB91a57c0fA58A754F` (deployed in block 29708629, deployer `0xf846339d05dbbbd92bdccb297b7f8269b236e9b5`)
- A read check shows `nextEscrowId` = 1, and the deployed code matches the tested build apart from the compiler metadata.
- App config lives in `.env.mainnet`. Build the mainnet app with `bun run build:mainnet` and host `dist/` yourself.
