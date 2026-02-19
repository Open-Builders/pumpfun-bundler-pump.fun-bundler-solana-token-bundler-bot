import { retrieveEnvVariable } from "../utils"
import { PublicKey } from "@solana/web3.js";
import log from "@slackgram/logger";

/** `mainnet` | `devnet`. Defaults to mainnet. */
const clusterRaw = (process.env.CLUSTER || "mainnet").toLowerCase()
if (clusterRaw !== "mainnet" && clusterRaw !== "devnet") {
  log.error('CLUSTER must be "mainnet" or "devnet"')
  process.exit(1)
}
export const CLUSTER = clusterRaw
/** True when CLUSTER=devnet (sequential RPC send; no Jito bundle). */
export const IS_DEVNET = CLUSTER === "devnet"

export const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY')

/** Active HTTP + WS RPC: mainnet uses RPC_*; devnet uses DEVNET_RPC_* only (mainnet RPC_* not required on devnet). */
function resolveActiveRpc(): { http: string; ws: string } {
  if (IS_DEVNET) {
    const http = (process.env.DEVNET_RPC_ENDPOINT || "").trim()
    const ws = (process.env.DEVNET_RPC_WEBSOCKET_ENDPOINT || "").trim()
    if (!http) {
      log.error("DEVNET_RPC_ENDPOINT is not set (required when CLUSTER=devnet)")
      process.exit(1)
    }
    if (!ws) {
      log.error("DEVNET_RPC_WEBSOCKET_ENDPOINT is not set (required when CLUSTER=devnet)")
      process.exit(1)
    }
    return { http, ws }
  }
  return {
    http: retrieveEnvVariable("RPC_ENDPOINT"),
    ws: retrieveEnvVariable("RPC_WEBSOCKET_ENDPOINT"),
  }
}

const activeRpc = resolveActiveRpc()
export const RPC_ENDPOINT = activeRpc.http
export const RPC_WEBSOCKET_ENDPOINT = activeRpc.ws

export const LIL_JIT_ENDPOINT = retrieveEnvVariable('LIL_JIT_ENDPOINT')
export const LIL_JIT_WEBSOCKET_ENDPOINT = retrieveEnvVariable('LIL_JIT_WEBSOCKET_ENDPOINT')

export const LIL_JIT_MODE = retrieveEnvVariable('LIL_JIT_MODE') == "true"

export const TOKEN_NAME = retrieveEnvVariable('TOKEN_NAME')
export const TOKEN_SYMBOL = retrieveEnvVariable('TOKEN_SYMBOL')
export const DESCRIPTION = retrieveEnvVariable('DESCRIPTION')
export const TOKEN_SHOW_NAME = retrieveEnvVariable('TOKEN_SHOW_NAME')
export const TOKEN_CREATE_ON = retrieveEnvVariable('TOKEN_CREATE_ON')
export const TWITTER = retrieveEnvVariable('TWITTER')
export const TELEGRAM = retrieveEnvVariable('TELEGRAM')
export const WEBSITE = retrieveEnvVariable('WEBSITE')
export const FILE = retrieveEnvVariable('FILE')
export const VANITY_MODE = retrieveEnvVariable('VANITY_MODE') == "true"

export const SWAP_AMOUNT = Number(retrieveEnvVariable('SWAP_AMOUNT'))
export const DISTRIBUTION_WALLETNUM = Number(retrieveEnvVariable('DISTRIBUTION_WALLETNUM'))

export const JITO_FEE = Number(retrieveEnvVariable('JITO_FEE'))
export const MINIMUM_JITO_TIP = Number(retrieveEnvVariable('MINIMUM_JITO_TIP'))
export const SIMULATE_ONLY = retrieveEnvVariable('SIMULATE_ONLY') == "true"

export const global_mint = new PublicKey("p89evAyzjd9fphjJx7G3RFA48sbZdpGEppRcfRNpump")
export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

export const BUYER_WALLET = retrieveEnvVariable('BUYER_WALLET')
export const BUYER_AMOUNT = Number(retrieveEnvVariable('BUYER_AMOUNT'))

