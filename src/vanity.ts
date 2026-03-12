import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import log from "@slackgram/logger";

export const generateVanityKeypair = (suffix: string): Keypair => {
  let attempts = 0;
  while (true) {
    const keypair = Keypair.generate();
    const pubkeyBase58 = keypair.publicKey.toBase58();
    attempts++;

    if (pubkeyBase58.endsWith(suffix)) {
      log.info(`✅ Match found after ${attempts} attempts`);
      log.info(`Public Key: ${pubkeyBase58}`);
      log.info(`Secret Key (base58): ${bs58.encode(keypair.secretKey)}`);
      return keypair;
    }

    // Optional: log progress every N attempts
    if (attempts % 10000 === 0) {
      log.info(`Checked ${attempts} keys...`);
    }
  }
}
