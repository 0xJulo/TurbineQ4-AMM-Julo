import * as anchor from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import {
  FEE,
  getPoolAddresses,
  payer,
  PoolContext,
  PROTOCOL_FEE,
  program,
  setupPool,
} from "./helpers/setup";

describe("initialize", () => {

  // Everything about this file's pool: the mints, the PDAs, the vaults.
  // It starts empty and is filled in inside before, because setting it up
  // means sending a transaction and waiting for it.

  let pool: PoolContext;

  before(async () => {
    pool = await setupPool(1);
  });

  // Write a test to initialise a pool.

  it("initializes a pool", async () => {
    await program.methods.initialize(
      pool.seed,
      FEE,
      PROTOCOL_FEE,
      payer.publicKey
    )
    .accountsPartial({
      initializer: payer.publicKey, // initializer = the payer's wallet
      mintX: pool.mintX,            // mint_x = your first test mint ("SOL")
      mintY: pool.mintY,            // mint_y = your second test mint ("BONK")
      config: pool.config,
      vaultX: pool.vaultX,
      vaultY: pool.vaultY,
      lpMint: pool.lpMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc(); // rpc() is what actually sends the transaction.

    // Get the config account from the initialisation.

    const configAccount = await program.account.config.fetch(pool.config);

    // Check to see if the fee equals what you have set
    // And if locked is false.

    expect(configAccount.fee).to.equal(FEE);
    expect(configAccount.protocolFee).to.equal(PROTOCOL_FEE);
    expect(configAccount.locked).to.equal(false);
    expect(configAccount.mintX.toBase58()).to.equal(pool.mintX.toBase58());
    expect(configAccount.mintY.toBase58()).to.equal(pool.mintY.toBase58());
    expect(configAccount.authority?.toBase58()).to.equal(payer.publicKey.toBase58());
    expect(configAccount.seed.toString()).to.equal(pool.seed.toString());
  });

  // A fee over MAX_FEE_BPS (10,000 = 100%) must be rejected with InvalidFee.

  it("fails to initialize with a fee over the max", async () => {

    // Seed 1 is already used by the first test, so its Config exists.
    // A new seed gives a fresh Config, so the only thing that can fail is the fee.

    const badSeed = new anchor.BN(2);
    const badFee = 10_001;

    // New seed, so every PDA and vault address is different too.

    const bad = getPoolAddresses(badSeed, pool.mintX, pool.mintY);

    // try: send the transaction, which should fail.
    // If it doesn't, expect.fail stops the test, because the fee check didn't work.
    // catch: check it failed for the right reason (InvalidFee), not something else.

    try {
      await program.methods.initialize(
        badSeed,
        badFee,
        PROTOCOL_FEE,
        payer.publicKey
      )
      .accountsPartial({
        initializer: payer.publicKey,
        mintX: pool.mintX,
        mintY: pool.mintY,
        config: bad.config,
        vaultX: bad.vaultX,
        vaultY: bad.vaultY,
        lpMint: bad.lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      expect.fail("initialize should have failed with InvalidFee");
    } catch (err) {
      expect(err).to.be.instanceOf(anchor.AnchorError);
      expect((err as anchor.AnchorError).error.errorCode.code).to.equal("InvalidFee");
    }
  });

});
