import { VersionedTransaction, Keypair, Connection, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, PublicKey } from "@solana/web3.js"
import base58 from "bs58"

import { CLUSTER, DISTRIBUTION_WALLETNUM, IS_DEVNET, LIL_JIT_MODE, PRIVATE_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, SWAP_AMOUNT, VANITY_MODE } from "./constants"
import { generateVanityAddress, saveDataToFile, sleep } from "./utils"
import { createTokenTx, distributeSol, createLUT, makeBuyIx, addAddressesToTableMultiExtend } from "./src/main";
import { executeJitoTx } from "./executor/jito";
import { sendBundle } from "./executor/liljito";
import log from "@slackgram/logger";


const commitment = "confirmed"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment
})
log.info(`CLUSTER=${CLUSTER} (${IS_DEVNET ? "RPC sequential bundle" : "Jito / Lil-Jit bundle"})`)
const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
log.info("mainKp", mainKp.publicKey.toBase58());
let kps: Keypair[] = []
const transactions: VersionedTransaction[] = []
let mintKp = Keypair.generate()
log.info("mintKp", mintKp.publicKey.toBase58());
if (VANITY_MODE) {
  const { keypair, pubkey } = generateVanityAddress("pump")
  mintKp = keypair
  log.info(`Keypair generated with "pump" ending: ${pubkey}`);
}
const mintAddress = mintKp.publicKey 
log.info("mintAddress", mintAddress.toBase58());


const main = async () => {

  const mainBal = await connection.getBalance(mainKp.publicKey)
  log.info((mainBal / 10 ** 9).toFixed(3), "SOL in main keypair")

  log.info("Mint address of token ", mintAddress.toBase58())
  saveDataToFile([base58.encode(mintKp.secretKey)], "mint.json")

  const tokenCreationIxs = await createTokenTx(mainKp, mintKp)
  if (tokenCreationIxs.length == 0) {
    log.error("Token creation failed")
    return
  }
  const minimumSolAmount = (SWAP_AMOUNT + 0.01) * DISTRIBUTION_WALLETNUM + 0.04

  if (mainBal / 10 ** 9 < minimumSolAmount) {
    log.error("Main wallet balance is not enough to run the bundler")
    log.error(`Plz charge the wallet more than ${minimumSolAmount}SOL`)
    return
  }

  log.info("Distributing SOL to wallets...")
  let result = await distributeSol(connection, mainKp, DISTRIBUTION_WALLETNUM)
  if (!result) {
    log.error("Distribution failed")
    return
  } else {
    kps = result
  }

  log.info("Creating LUT started")
  const lutAddress = await createLUT(mainKp)
  if (!lutAddress) {
    log.error("Lut creation failed")
    return
  }
  log.info("LUT Address:", lutAddress.toBase58())
  saveDataToFile([lutAddress.toBase58()], "lut.json")
  if (!(await addAddressesToTableMultiExtend(lutAddress, mintAddress, kps, mainKp))) {
    log.error("Adding addresses to table failed")
    return
  }

  const buyIxsPerWallet: TransactionInstruction[][] = []

  for (let i = 0; i < DISTRIBUTION_WALLETNUM; i++) {
    const ixs = await makeBuyIx(kps[i], Math.floor(SWAP_AMOUNT * 10 ** 9), i, mainKp.publicKey, mintAddress)
    buyIxsPerWallet.push(ixs)
  }

  const lookupTable = (await connection.getAddressLookupTable(lutAddress)).value;
  if (!lookupTable) {
    log.error("Lookup table not ready")
    return
  }

  const latestBlockhash = await connection.getLatestBlockhash()

  const tokenCreationTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: mainKp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: tokenCreationIxs
    }).compileToV0Message()
  )

  tokenCreationTx.sign([mainKp, mintKp])

  // const simResult = await connection.simulateTransaction(tokenCreationTx, { sigVerify: false });
  // log.info("Simulation result:", simResult.value);
  // if (simResult.value.err) {
  //   log.error("Simulation failed. Adjust compute units or batch size.");
  //   return;
  // }

  // const sig = await connection.sendTransaction(tokenCreationTx, { skipPreflight: true })
  // log.info("Transaction sent:", sig)
  // const confirmation = await connection.confirmTransaction(sig, "confirmed")
  // log.info("Transaction confirmed:", confirmation)
  // if (confirmation.value.err) {
  //   log.error("Transaction failed")
  //   return
  // }

  transactions.push(tokenCreationTx)
  for (let i = 0; i < Math.ceil(DISTRIBUTION_WALLETNUM / 4); i++) {
    const latestBlockhash = await connection.getLatestBlockhash()
    const instructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
    ]

    for (let j = 0; j < 4; j++) {
      const index = i * 4 + j
      if (kps[index]) {
        instructions.push(...buyIxsPerWallet[index])
        log.info("Transaction instruction added:", kps[index].publicKey.toString())
      }
    }
    const msg = new TransactionMessage({
      payerKey: kps[i * 4].publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions
    }).compileToV0Message([lookupTable])
    log.info("Transaction message compiled:", msg)

    const tx = new VersionedTransaction(msg)
    log.info("Transaction created:", tx)

    for (let j = 0; j < 4; j++) {
      const index = i * 4 + j
      if (kps[index]) {
        tx.sign([kps[index]])
        log.info("Transaction signed:", kps[index].publicKey.toString())
      }
    }
    log.info("transaction size", tx.serialize().length)

    // const simResult = await connection.simulateTransaction(tx, { sigVerify: false });
    // log.info("Simulation result:", simResult.value);
    // if (simResult.value.err) {
    //   log.error("Simulation failed. Adjust compute units or batch size.");
    //   return;
    // }

    // const sig = await connection.sendTransaction(tx, { skipPreflight: true })
    // log.info("Transaction sent:", sig)
    // const confirmation = await connection.confirmTransaction(sig, "confirmed")
    // log.info("Transaction confirmed:", confirmation)
    // if (confirmation.value.err) {
    //   log.error("Transaction failed")
    //   return
    // }

    transactions.push(tx)
  }

  // transactions.map(async (tx, i) => log.info(i, " | ", tx.serialize().length, "bytes | \n", (await connection.simulateTransaction(tx, { sigVerify: true }))))

  log.info("Sending bundle...")
  if (IS_DEVNET) {
    log.info("Devnet: sending transactions in order over RPC (no Jito).")
    for (let i = 0; i < transactions.length; i++) {
      const sig = await connection.sendTransaction(transactions[i], {
        skipPreflight: true,
        maxRetries: 3,
      })
      log.info(`Tx ${i + 1}/${transactions.length}:`, sig)
      const conf = await connection.confirmTransaction(sig, commitment)
      if (conf.value.err) {
        log.error("Transaction failed:", conf.value.err)
        return
      }
      await sleep(600)
    }
  } else if (LIL_JIT_MODE) {
    const bundleId = await sendBundle(transactions)
    if (!bundleId) {
      log.error("Failed to send bundle")
      return
    }
  } else {
    await executeJitoTx(transactions, mainKp, commitment)
  }
  await sleep(10000)
}

main()
