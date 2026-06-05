# Pumpfun bundler · Pump.fun bundler · Solana bundler (pump.fun)

**Pumpfun bundler** / **pump.fun bundler** — a **solana bundler** for pump.fun: multi-wallet SOL distribution, Address Lookup Tables, and coordinated buys using **Jito** or **Lil-Jit** on **mainnet**, or sequential RPC on **devnet**. This folder is the **pump.fun bundler** half of the parent monorepo; 

## About this pumpfun bundler (pump.fun bundler)

**Pumpfun bundler** · **Pump.fun bundler** · **Solana bundler** focused on pump.fun. Flow: optional vanity mint (suffix `pump`), token create + metadata, fund child wallets, extend LUT, build per-wallet buy instructions, then submit as a Jito/Lil-Jit bundle on mainnet or run the devnet path without Jito. Stack includes **`@pump-fun/pump-sdk`**, **`@solana/web3.js`**, structured logging via **`@slackgram/logger`**, and optional **Fleek** credentials for [`src/uploadToIpfs.ts`](src/uploadToIpfs.ts).

## Features

- **Multi-wallet bundling** — **Pumpfun bundler** splits SOL and fires coordinated buys after create
- **Vanity mint** — `VANITY_MODE=true` generates a mint keypair ending in `pump`
- **Cluster switch** — `CLUSTER=mainnet` (Jito / Lil-Jit) or `CLUSTER=devnet` (devnet RPC only; no Jito bundle)
- **Dual bundle backends** — `LIL_JIT_MODE=false` → Jito; `true` → Lil-Jit endpoints from `.env`
- **LUTs** — Create, extend, then close with `npm run close`
- **Retries & logging** — RPC/bundle resilience and `pino`-style logs via `@slackgram/logger`
- **Single-wallet script** — `npm run single` uses `BUYER_WALLET` / `BUYER_AMOUNT`

## Prerequisites

- Node.js 16+ (ts-node runs TypeScript directly)
- npm or yarn
- Enough SOL on the main wallet for distribution, fees, and (mainnet) Jito tip (`JITO_FEE`, plus `MINIMUM_JITO_TIP` where applicable)

## Installation

From the **repository root** (not only this folder):

```bash
git clone <repository-url>
cd <your-clone-directory>/pumpfun
npm install
cp .env.example .env
# Edit .env — see below
```

## Configuration

**Source of truth:** [`.env.example`](.env.example). Copy it to `.env` and fill every required field for your `CLUSTER`.

| Variable | Role |
| --- | --- |
| `CLUSTER` | `mainnet` (default) or `devnet` |
| `RPC_ENDPOINT` / `RPC_WEBSOCKET_ENDPOINT` | Required when `CLUSTER=mainnet` |
| `DEVNET_RPC_ENDPOINT` / `DEVNET_RPC_WEBSOCKET_ENDPOINT` | Required when `CLUSTER=devnet` (mainnet RPC vars are not read) |
| `LIL_JIT_MODE` | `false` = Jito bundle path; `true` = Lil-Jit (`LIL_JIT_*` URLs required on mainnet) |
| `SWAP_AMOUNT` | SOL per bundler wallet buy |
| `DISTRIBUTION_WALLETNUM` | Number of child wallets |
| `JITO_FEE` | Jito tip in SOL (mainnet create path) |
| `MINIMUM_JITO_TIP` | Numeric floor used with tip logic (see constants) |
| `SIMULATE_ONLY` | `true` / `false` — simulation-only flag wired through config |
| `PRIVATE_KEY` | Main wallet (base58 secret) |
| `BUYER_WALLET` / `BUYER_AMOUNT` | Used by `npm run single` |
| `TOKEN_*`, `DESCRIPTION`, `FILE`, social URLs | Metadata; `TOKEN_SHOW_NAME` is `"true"` or `"false"` (sent as `showName` to the API) |
| `VANITY_MODE` | `true` / `false` |
| `PAT` / `PROJECT_ID` | Optional — **Fleek** IPFS upload script only |

### Mainnet vs devnet

- **Mainnet** — Bundles go through Jito or Lil-Jit depending on `LIL_JIT_MODE`.
- **Devnet** — Set `CLUSTER=devnet` and devnet RPC URLs; execution follows the devnet/RPC sequential path (no Jito bundle).

### Jito vs Lil-Jit (mainnet)

- **Jito** — `LIL_JIT_MODE=false`; regional endpoints and failover live in executor code.
- **Lil-Jit** — `LIL_JIT_MODE=true`; set `LIL_JIT_ENDPOINT` and `LIL_JIT_WEBSOCKET_ENDPOINT`.

## Usage

| Script | Command | Purpose |
| --- | --- | --- |
| Multi-wallet | `npm start` | Runs `ts-node index.ts` — full **pumpfun bundler** flow |
| Single buyer | `npm run single` | `ts-node oneWalletBundle.ts` |
| Close LUT | `npm run close` | `ts-node closeLut.ts` |
| Gather SOL | `npm run gather` | `ts-node gather.ts` |
| Status | `npm run status` | `ts-node status.ts` |

## Technical notes

- **Entry** — [`index.ts`](index.ts) orchestrates create → distribute → LUT → buys → bundle send.
- **Executors** — [`executor/jito.ts`](executor/jito.ts), [`executor/liljito.ts`](executor/liljito.ts), [`executor/legacy.ts`](executor/legacy.ts).
- **Constants** — [`constants/constants.ts`](constants/constants.ts) loads and validates `.env` (including `CLUSTER`, tips, simulation flag).
- **Keys** — Generated material under `keys/`; keep out of git.

## Troubleshooting

- **RPC errors** — Use a paid mainnet RPC with high limits; on devnet use healthy public or dedicated devnet URLs.
- **Bundle failures** — Raise `JITO_FEE`, confirm `MINIMUM_JITO_TIP`, verify Lil-Jit URLs when `LIL_JIT_MODE=true`, reduce wallet count or bundle size.
- **Insufficient SOL** — The code checks roughly `(SWAP_AMOUNT + 0.01) * DISTRIBUTION_WALLETNUM + 0.04` SOL before distribution; keep extra headroom for fees and tips.

## Security

Never commit `.env` or `keys/`. Use dedicated launch wallets and least-privilege funding.

## Disclaimer

Educational and research use. You are responsible for compliance, taxes, key safety, and platform terms.

## License

ISC — see repository LICENSE.

---

## Keywords (SEO)

- **Pumpfun bundler** — Multi-wallet **pumpfun bundler** for pump.fun with Jito/Lil-Jit (mainnet) or devnet RPC flow.
- **Pump.fun bundler** — Same as **pumpfun bundler**; **pump.fun bundler** keywords point to this `pumpfun/` package.
- **Solana bundler** — This **solana bundler** module is pump.fun-specific.
