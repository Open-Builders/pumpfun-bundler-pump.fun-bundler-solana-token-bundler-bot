import { ComputeBudgetProgram, Connection, Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import { BUYER_AMOUNT, BUYER_WALLET, CLUSTER, IS_DEVNET, PRIVATE_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, SWAP_AMOUNT, VANITY_MODE } from "./constants"
import { createTokenTx, makeBuyIx } from "./src/main"

import base58 from "bs58"
import { generateVanityAddress } from "./utils"
import { executeJitoTx } from "./executor/jito"
import log from "@slackgram/logger";

const commitment = "confirmed"

let mintKp = Keypair.generate()
if (VANITY_MODE) {
  const { keypair, pubkey } = generateVanityAddress("pump")
  mintKp = keypair
  log.info(`Keypair generated with "pump" ending: ${pubkey}`);
}

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment
})
log.info(`CLUSTER=${CLUSTER} (${IS_DEVNET ? "RPC sequential" : "Jito bundle"})`)
const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

const smallNumWalletBundle = async () => {
  try {
    const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
    const tokenCreationIxs = await createTokenTx(mainKp, mintKp)
    const latestBlockhash = await connection.getLatestBlockhash()

    const tokenCreationTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: mainKp.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: tokenCreationIxs
      }).compileToV0Message()
    )
    tokenCreationTx.sign([mainKp, mintKp])

    const buyIx = await makeBuyIx(buyerKp, Math.floor(BUYER_AMOUNT * 10 ** 9), 0, mainKp.publicKey, mintKp.publicKey)
    const msg = new TransactionMessage({
      payerKey: buyerKp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
        ...buyIx
      ]
    }).compileToV0Message()
    const buyTx = new VersionedTransaction(msg)
    buyTx.sign([buyerKp])
    if (IS_DEVNET) {
      for (const [i, tx] of [tokenCreationTx, buyTx].entries()) {
        const sig = await connection.sendTransaction(tx, {
          skipPreflight: true,
          maxRetries: 3,
        })
        log.info(`Devnet tx ${i + 1}/2:`, sig)
        const conf = await connection.confirmTransaction(sig, commitment)
        if (conf.value.err) {
          log.error("Transaction failed:", conf.value.err)
          return
        }
        await new Promise((r) => setTimeout(r, 600))
      }
    } else {
      await executeJitoTx([tokenCreationTx, buyTx], mainKp, commitment)
    }
  } catch (error) {
    log.error("Error in bundle process:", error)
  }
}

smallNumWalletBundle()
