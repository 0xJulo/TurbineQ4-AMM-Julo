import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Amm } from "../target/types/amm";
import { createMint, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";

describe("amm", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Load the Amm program
  const program = anchor.workspace.amm as Program<Amm>;

  // Variable for seed which will be reused in tests
  // This is part of what you need to create a unique pool
  const seed = new anchor.BN(42);

  // Set the pool fee in basis point
  const fee = 30;

  // Get the PDA for the config and lp mint.
  // This returns an array of [address, bump], hence the brackets
  // in the variable name. The seeds must match the program's seeds,
  // in the same order, to get the right PDA.

  const [config] = anchor.web3.PublicKey.findProgramAddressSync([
    Buffer.from("config"),
    seed.toArrayLike(Buffer, "le", 8),
  ], program.programId);

  const [lpMint] = anchor.web3.PublicKey.findProgramAddressSync([
    Buffer.from("lp"),
    config.toBuffer(),
  ], program.programId);

  const payer = (provider.wallet as anchor.Wallet).payer;

  // Create two mints for the pool. This needs to be done before the tests.
  // The let variables start empty but set the type, and the before function
  // is an async function that actually creates the mints.
  // The arguments to createMint are the connection, the payer, the mint
  // authority, the freeze authority and the decimals.

  let mintX: anchor.web3.PublicKey;
  let mintY: anchor.web3.PublicKey;

  let vaultX: anchor.web3.PublicKey;
  let vaultY: anchor.web3.PublicKey;

  before(async () => {

    // Create the mints for both tokens 

    mintX = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6,
    );

    mintY = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6,
    );

    // Get the ATA for the tokens
    // They need the mint and config to access

    vaultX = getAssociatedTokenAddressSync(mintX, config, true);
    vaultY = getAssociatedTokenAddressSync(mintY, config, true);
  });

  // Write a test to initialise a pool.

  it("initializes a pool", async () => {
    await program.methods.initialize(
      seed,
      fee,
      payer.publicKey
    )
    .accountsPartial({
      initializer: payer.publicKey, // initializer = the payer's wallet
      mintX: mintX,                 // mint_x = your first test mint ("SOL")
      mintY: mintY,                 // mint_y = your second test mint ("BONK")
      config,
      vaultX,
      vaultY,
      lpMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc(); // rpc() is what actually sends the transaction.

    // Get the config account from the initialisation.

    const configAccount = await program.account.config.fetch(config);

    // Check to see if the fee equals what you have set
    // And if locked is false.

    expect(configAccount.fee).to.equal(fee);
    expect(configAccount.locked).to.equal(false);
    expect(configAccount.mintX.toBase58()).to.equal(mintX.toBase58());
    expect(configAccount.mintY.toBase58()).to.equal(mintY.toBase58());
    expect(configAccount.authority?.toBase58()).to.equal(payer.publicKey.toBase58());
    expect(configAccount.seed.toString()).to.equal(seed.toString());
  });

  // A fee over MAX_FEE_BPS (10,000 = 100%) must be rejected with InvalidFee.

  it("fails to initialize with a fee over the max", async () => {

    // Seed 42 is already used by the first test, so its Config exists.
    // A new seed gives a fresh Config, so the only thing that can fail is the fee.

    const badSeed = new anchor.BN(99);
    const badFee = 10_001;

    // New seed, so every PDA and vault address is different too.

    const [badConfig] = anchor.web3.PublicKey.findProgramAddressSync([
      Buffer.from("config"),
      badSeed.toArrayLike(Buffer, "le", 8),
    ], program.programId);

    const [badLpMint] = anchor.web3.PublicKey.findProgramAddressSync([
      Buffer.from("lp"),
      badConfig.toBuffer(),
    ], program.programId);

    const badVaultX = getAssociatedTokenAddressSync(mintX, badConfig, true);
    const badVaultY = getAssociatedTokenAddressSync(mintY, badConfig, true);

    // try: send the transaction, which should fail.
    // If it doesn't, expect.fail stops the test, because the fee check didn't work.
    // catch: check it failed for the right reason (InvalidFee), not something else.

    try {
      await program.methods.initialize(
        badSeed,
        badFee,
        payer.publicKey
      )
      .accountsPartial({
        initializer: payer.publicKey,
        mintX: mintX,
        mintY: mintY,
        config: badConfig,
        vaultX: badVaultX,
        vaultY: badVaultY,
        lpMint: badLpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      expect.fail("initialize should have failed with InvalidFee");
    } catch (err) {
      expect(err).to.be.instanceOf(anchor.AnchorError);
      expect((err as anchor.AnchorError).error.errorCode.code).to.equal("InvalidFee");
    }
  });

});
