import {
  AccountInfo,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import { openAsBlob } from "fs";
import path from "path";
import base58 from "bs58";
import {
  bondingCurvePda,
  BONDING_CURVE_NEW_SIZE,
  creatorVaultPda,
  getBuyTokenAmountFromSolAmount,
  getGlobalParamsPda,
  getMayhemStatePda,
  getSolVaultPda,
  getTokenVaultPda,
  GLOBAL_PDA,
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  MAYHEM_PROGRAM_ID,
  newBondingCurve,
  OnlinePumpSdk,
  PUMP_EVENT_AUTHORITY_PDA,
  PUMP_FEE_CONFIG_PDA,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PumpSdk,
  userVolumeAccumulatorPda,
} from "@pump-fun/pump-sdk";
import {
  DESCRIPTION,
  FILE,
  IS_DEVNET,
  JITO_FEE,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  SWAP_AMOUNT,
  TELEGRAM,
  TOKEN_CREATE_ON,
  TOKEN_NAME,
  TOKEN_SHOW_NAME,
  TOKEN_SYMBOL,
  TWITTER,
  WEBSITE,
} from "../constants";
import { saveDataToFile, sleep } from "../utils";
import { createAndSendV0Tx, execute } from "../executor/legacy";
import log from "@slackgram/logger";

const commitment = "confirmed";

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment,
});

const pumpSdk = new PumpSdk();
const onlinePump = new OnlinePumpSdk(connection);

let kps: Keypair[] = [];

/** Metaplex Token Metadata program (create instruction). */
const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

function pumpMintAuthorityPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM_ID
  )[0];
}

function metaplexMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID
  )[0];
}

/** Fee recipients used when global has none (matches pump.fun bundler buy flow). */
const STATIC_FEE_RECIPIENTS = [
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
  "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
  "7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX",
  "9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz",
  "AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY",
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
  "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz",
  "G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP",
];

const JITO_TIP_ACCOUNT_STRINGS = [
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
];

async function uploadMetadataToPumpFun(): Promise<string> {
  const fileBlob = await openAsBlob(FILE);
  const formData = new FormData();
  formData.append("file", fileBlob, path.basename(FILE));
  formData.append("name", TOKEN_NAME);
  formData.append("symbol", TOKEN_SYMBOL);
  formData.append("description", DESCRIPTION);
  formData.append("twitter", TWITTER || "");
  formData.append("telegram", TELEGRAM || "");
  formData.append("website", WEBSITE || "");
  formData.append("showName", String(TOKEN_SHOW_NAME === "true"));
  formData.append("createOn", TOKEN_CREATE_ON || "");

  const response = await fetch("https://pump.fun/api/ipfs", {
    method: "POST",
    headers: {
      Host: "www.pump.fun",
      Accept: "*/*",
      Referer: "https://www.pump.fun/create",
      Origin: "https://www.pump.fun",
    },
    body: formData,
  });

  const json = (await response.json()) as {
    metadataUri?: string;
    uri?: string;
    error?: unknown;
  };
  const uri = json.metadataUri ?? json.uri;
  if (!uri || typeof uri !== "string") {
    throw new Error(
      `Pump.fun metadata upload failed: ${JSON.stringify(json)}`
    );
  }
  return uri;
}

// create token instructions (Token-2022 createV2 + extend bonding curve + creator ATA)
export const createTokenTx = async (
  mainKp: Keypair,
  mintKp: Keypair
): Promise<TransactionInstruction[]> => {
  const metadataUri = await uploadMetadataToPumpFun();
  const mint = mintKp.publicKey;
  const creator = mainKp.publicKey;

  const createIx = await pumpSdk.createV2Instruction({
    mint,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: metadataUri,
    creator,
    user: creator,
    mayhemMode: false,
    cashback: false,
  });

  const extendIx = await pumpSdk.extendAccountInstruction({
    account: bondingCurvePda(mint),
    user: creator,
  });

  const associatedUser = getAssociatedTokenAddressSync(
    mint,
    creator,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    creator,
    associatedUser,
    creator,
    mint,
    TOKEN_2022_PROGRAM_ID
  );

  const budgetIxs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
  ];

  // Jito tips are for mainnet block-engine bundles only; skip on devnet.
  if (!IS_DEVNET) {
    const tipAccounts = JITO_TIP_ACCOUNT_STRINGS;
    const jitoFeeWallet = new PublicKey(
      tipAccounts[Math.floor(Math.random() * tipAccounts.length)]
    );
    budgetIxs.push(
      SystemProgram.transfer({
        fromPubkey: mainKp.publicKey,
        toPubkey: jitoFeeWallet,
        lamports: Math.floor(JITO_FEE * 10 ** 9),
      })
    );
  }

  return [...budgetIxs, createIx, extendIx, createAtaIx];
};

export const distributeSol = async (
  connection: Connection,
  mainKp: Keypair,
  distritbutionNum: number
) => {
  try {
    const sendSolTx: TransactionInstruction[] = [];
    sendSolTx.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 })
    );
    const mainSolBal = await connection.getBalance(mainKp.publicKey);
    if (mainSolBal <= 4 * 10 ** 6) {
      log.error("Main wallet balance is not enough");
      return [];
    }
    const solAmount = Math.floor((SWAP_AMOUNT + 0.01) * 10 ** 9);

    for (let i = 0; i < distritbutionNum; i++) {
      const wallet = Keypair.generate();
      kps.push(wallet);

      sendSolTx.push(
        SystemProgram.transfer({
          fromPubkey: mainKp.publicKey,
          toPubkey: wallet.publicKey,
          lamports: solAmount,
        })
      );
    }

    try {
      saveDataToFile(kps.map((kp) => base58.encode(kp.secretKey)));
    } catch (error) {
      /* ignore */
    }

    let index = 0;
    while (true) {
      try {
        if (index > 5) {
          log.error("Error in distribution");
          return null;
        }
        const latestBlockhash = await connection.getLatestBlockhash();
        const messageV0 = new TransactionMessage({
          payerKey: mainKp.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: sendSolTx,
        }).compileToV0Message();
        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([mainKp]);
        const txSig = await execute(transaction, latestBlockhash, 1);

        if (txSig) {
          const clusterQs = IS_DEVNET ? "?cluster=devnet" : "";
          const distibuteTx = txSig
            ? `https://solscan.io/tx/${txSig}${clusterQs}`
            : "";
          log.info("SOL distributed ", distibuteTx);
          break;
        }
        index++;
      } catch (error) {
        index++;
      }
    }
    log.info("Success in distribution");
    return kps;
  } catch (error) {
    log.error(`Failed to transfer SOL`, error);
    return null;
  }
};

export const createLUT = async (mainKp: Keypair) => {
  let i = 0;
  while (true) {
    if (i > 5) {
      log.error("LUT creation failed, Exiting...");
      return;
    }
    const slot = await connection.getSlot("confirmed");
    try {
      const [lookupTableInst, lookupTableAddress] =
        AddressLookupTableProgram.createLookupTable({
          authority: mainKp.publicKey,
          payer: mainKp.publicKey,
          recentSlot: slot,
        });

      log.info("Lookup Table Address:", lookupTableAddress.toBase58());

      const result = await createAndSendV0Tx(
        [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: 500_000,
          }),
          lookupTableInst,
        ],
        mainKp,
        connection
      );

      if (!result) throw new Error("Lut creation error");

      log.info("Lookup Table Address created successfully!");
      log.info("Please wait for about 15 seconds...");
      await sleep(15000);

      return lookupTableAddress;
    } catch (err) {
      log.error("Retrying to create Lookuptable until it is created...");
      i++;
    }
  }
};

async function gatherPumpBundlerLutAddresses(
  mint: PublicKey,
  creator: PublicKey,
  walletKPs: Keypair[]
): Promise<PublicKey[]> {
  const global = await onlinePump.fetchGlobal();
  const tokenProgram = TOKEN_2022_PROGRAM_ID;
  const bundlerPubkeys = walletKPs.map((w) => w.publicKey);

  const list: PublicKey[] = [];
  const addTo = (p: PublicKey) => {
    const k = p.toBase58();
    if (!list.some((x) => x.toBase58() === k)) list.push(p);
  };

  addTo(creator);
  addTo(mint);
  const bondingCurve = bondingCurvePda(mint);
  const bondingCurveAta = getAssociatedTokenAddressSync(
    mint,
    bondingCurve,
    true,
    tokenProgram
  );
  addTo(bondingCurve);
  addTo(bondingCurveAta);
  addTo(creatorVaultPda(creator));
  addTo(GLOBAL_PDA);
  addTo(PUMP_EVENT_AUTHORITY_PDA);
  addTo(global.feeRecipient);
  if (global.feeRecipients) {
    for (const fr of global.feeRecipients) {
      if (fr && !fr.equals(PublicKey.default)) addTo(fr);
    }
  }
  for (const s of STATIC_FEE_RECIPIENTS) addTo(new PublicKey(s));

  addTo(pumpMintAuthorityPda());
  addTo(MPL_TOKEN_METADATA_PROGRAM_ID);
  addTo(metaplexMetadataPda(mint));
  addTo(SYSVAR_RENT_PUBKEY);
  addTo(MAYHEM_PROGRAM_ID);
  addTo(getGlobalParamsPda());
  addTo(getSolVaultPda());
  addTo(getMayhemStatePda(mint));
  addTo(getTokenVaultPda(mint));

  addTo(SystemProgram.programId);
  addTo(TOKEN_2022_PROGRAM_ID);
  addTo(ASSOCIATED_TOKEN_PROGRAM_ID);
  addTo(PUMP_PROGRAM_ID);
  addTo(PUMP_FEE_PROGRAM_ID);

  for (const w of bundlerPubkeys) {
    addTo(w);
    addTo(getAssociatedTokenAddressSync(mint, w, true, tokenProgram));
    addTo(userVolumeAccumulatorPda(w));
  }

  addTo(GLOBAL_VOLUME_ACCUMULATOR_PDA);
  addTo(PUMP_FEE_CONFIG_PDA);

  if (!IS_DEVNET) {
    for (const tip of JITO_TIP_ACCOUNT_STRINGS) addTo(new PublicKey(tip));
  }

  return list;
}

async function extendLookupTableInChunks(
  lutAddress: PublicKey,
  mainKp: Keypair,
  addresses: PublicKey[],
  maxRetries = 5
): Promise<boolean> {
  const CHUNK = 20;

  async function extendWithRetry(
    chunk: PublicKey[],
    stepName: string
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const instruction = AddressLookupTableProgram.extendLookupTable({
        payer: mainKp.publicKey,
        authority: mainKp.publicKey,
        lookupTable: lutAddress,
        addresses: chunk,
      });

      const result = await createAndSendV0Tx(
        [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: 500_000,
          }),
          instruction,
        ],
        mainKp,
        connection
      );

      if (result) {
        log.info(`✅ ${stepName} successful.`);
        return true;
      }
      log.info(`⚠️ Retry ${attempt}/${maxRetries} for ${stepName}`);
    }
    log.error(`❌ ${stepName} failed after ${maxRetries} attempts.`);
    return false;
  }

  for (let i = 0; i < addresses.length; i += CHUNK) {
    const slice = addresses.slice(i, i + CHUNK);
    const stepName = `LUT extend chunk ${Math.floor(i / CHUNK) + 1} (${slice.length} addrs)`;
    if (!(await extendWithRetry(slice, stepName))) return false;
    await sleep(10_000);
  }
  return true;
}

export async function addAddressesToTableMultiExtend(
  lutAddress: PublicKey,
  mint: PublicKey,
  walletKPs: Keypair[],
  mainKp: Keypair
) {
  try {
    const addresses = await gatherPumpBundlerLutAddresses(
      mint,
      mainKp.publicKey,
      walletKPs
    );
    const ok = await extendLookupTableInChunks(
      lutAddress,
      mainKp,
      addresses
    );
    if (!ok) return false;
    log.info("🎉 Lookup Table successfully extended!");
    log.info(
      `🔗 LUT Entries: https://explorer.solana.com/address/${lutAddress.toString()}/entries`
    );
    return true;
  } catch (err) {
    log.error("Error extending LUT:", err);
    return false;
  }
}

export async function addAddressesToTable(
  lutAddress: PublicKey,
  mint: PublicKey,
  walletKPs: Keypair[],
  mainKp: Keypair
) {
  try {
    const ok = await addAddressesToTableMultiExtend(
      lutAddress,
      mint,
      walletKPs,
      mainKp
    );
    if (ok) {
      log.info("Lookup Table Address extended successfully!");
      log.info(
        `Lookup Table Entries: `,
        `https://explorer.solana.com/address/${lutAddress.toString()}/entries`
      );
    }
  } catch (err) {
    log.error(
      "There is an error in adding addresses in LUT. Please retry it."
    );
  }
}

const SLIPPAGE_FRACTION = 0.08;

export const makeBuyIx = async (
  kp: Keypair,
  buyAmountLamports: number,
  _index: number,
  creator: PublicKey,
  mintAddress: PublicKey
): Promise<TransactionInstruction[]> => {
  const global = await onlinePump.fetchGlobal();
  const tokenProgram = TOKEN_2022_PROGRAM_ID;

  const bondingCurve = newBondingCurve(global);
  bondingCurve.creator = creator;
  bondingCurve.isMayhemMode = false;

  const curveAccountInfo: AccountInfo<Buffer> = {
    data: Buffer.alloc(BONDING_CURVE_NEW_SIZE),
    executable: false,
    owner: PUMP_PROGRAM_ID,
    lamports: 0,
    rentEpoch: 0,
  };

  const solAmountLamports = new BN(Math.floor(buyAmountLamports));
  const amount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig: null,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: solAmountLamports,
  });
  const solAmountWithSlippage = solAmountLamports.add(
    solAmountLamports.muln(Math.floor(SLIPPAGE_FRACTION * 1000)).divn(1000)
  );

  return pumpSdk.buyInstructions({
    global,
    bondingCurveAccountInfo: curveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo: null,
    mint: mintAddress,
    user: kp.publicKey,
    solAmount: solAmountWithSlippage,
    amount,
    slippage: 0,
    tokenProgram,
  });
};
