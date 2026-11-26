// Shared setup for every test file.
//
// Each test file imports from here and calls setupPool() with its own seed,
// so every file gets its own fresh pool and can run on its own, in any order.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Amm } from "../../target/types/amm";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

// Configure the client to use the local cluster.

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

// Load the Amm program.

export const program = anchor.workspace.amm as Program<Amm>;

// The wallet that pays for and signs the setup transactions.
// It also acts as the user in the tests.

export const payer = (provider.wallet as anchor.Wallet).payer;

// The pool fee used by the tests, in basis points (30 = 0.3%).

export const FEE = 30;

// The share of each swap fee that goes to the protocol's treasury,
// in basis points (2,000 = 20% of the fee). The rest stays in the pool.

export const PROTOCOL_FEE = 2_000;

// Both test mints have 6 decimals, so one whole token is 1,000,000
// in the smallest unit. Amounts on-chain are always in the smallest unit.

export const DECIMALS = 6;
export const ONE_TOKEN = 1_000_000;

// How many of each token the user starts with: 1,000 tokens.

export const USER_START_BALANCE = 1_000 * ONE_TOKEN;

// Everything a test needs to know about one pool and its user.

export type PoolContext = {
  seed: anchor.BN;                 // the pool's seed
  mintX: anchor.web3.PublicKey;    // test mint for token X
  mintY: anchor.web3.PublicKey;    // test mint for token Y
  config: anchor.web3.PublicKey;   // the pool's Config PDA
  lpMint: anchor.web3.PublicKey;   // the pool's LP mint PDA
  vaultX: anchor.web3.PublicKey;   // config's token account for X
  vaultY: anchor.web3.PublicKey;   // config's token account for Y
  treasury: anchor.web3.PublicKey;   // the treasury PDA, which owns the two below
  treasuryX: anchor.web3.PublicKey;  // the treasury's token account for X
  treasuryY: anchor.web3.PublicKey;  // the treasury's token account for Y
  userX: anchor.web3.PublicKey;    // the user's token account for X
  userY: anchor.web3.PublicKey;    // the user's token account for Y
  userLp: anchor.web3.PublicKey;   // the user's token account for LP tokens
};

// Work out the addresses that belong to one pool.
//
// The Config and LP mint are PDAs: findProgramAddressSync returns
// [address, bump], hence the brackets. The seeds must match the program's
// seeds, in the same order, to get the right PDA.
//
// The vaults are ATAs owned by config. Config is a PDA (off the curve),
// so allowOwnerOffCurve has to be true.

export function getPoolAddresses(
  seed: anchor.BN,
  mintX: anchor.web3.PublicKey,
  mintY: anchor.web3.PublicKey,
) {
  const [config] = anchor.web3.PublicKey.findProgramAddressSync([
    Buffer.from("config"),
    seed.toArrayLike(Buffer, "le", 8),
  ], program.programId);

  const [lpMint] = anchor.web3.PublicKey.findProgramAddressSync([
    Buffer.from("lp"),
    config.toBuffer(),
  ], program.programId);

  const vaultX = getAssociatedTokenAddressSync(mintX, config, true);
  const vaultY = getAssociatedTokenAddressSync(mintY, config, true);

  // The treasury is a PDA too, with seeds ["treasury", config]. Its token
  // accounts are ATAs owned by it, the same way the vaults are owned by config.

  const [treasury] = anchor.web3.PublicKey.findProgramAddressSync([
    Buffer.from("treasury"),
    config.toBuffer(),
  ], program.programId);

  const treasuryX = getAssociatedTokenAddressSync(mintX, treasury, true);
  const treasuryY = getAssociatedTokenAddressSync(mintY, treasury, true);

  return { config, lpMint, vaultX, vaultY, treasury, treasuryX, treasuryY };
}

// Build everything a test file needs, for the pool with the given seed:
//   - two new test mints
//   - the pool's addresses (config, LP mint, vaults)
//   - the user's token accounts, holding USER_START_BALANCE of each token
//
// It does NOT call initialize. The pool's accounts do not exist yet, only
// their addresses are known. Each test file decides what to do from here.

export async function setupPool(seedNumber: number): Promise<PoolContext> {
  const seed = new anchor.BN(seedNumber);

  // A mint lives at a normal (non-PDA) address, so each one needs a new keypair.

  const mintXKeypair = anchor.web3.Keypair.generate();
  const mintYKeypair = anchor.web3.Keypair.generate();
  const mintX = mintXKeypair.publicKey;
  const mintY = mintYKeypair.publicKey;

  // The user's own token accounts for X and Y. The user is the payer wallet.

  const userX = getAssociatedTokenAddressSync(mintX, payer.publicKey);
  const userY = getAssociatedTokenAddressSync(mintY, payer.publicKey);

  // How much SOL a mint account needs to be rent exempt.

  const mintRent = await getMinimumBalanceForRentExemptMint(provider.connection);

  // One transaction that creates both mints, creates the user's two token
  // accounts, and mints the user their starting tokens.
  //
  // Creating a mint takes two instructions: the System Program creates an
  // empty account owned by the Token Program, then the Token Program sets it
  // up as a mint. The payer is the mint authority, so it is allowed to mint.

  const setupTx = new anchor.web3.Transaction();

  for (const mint of [mintX, mintY]) {
    setupTx.add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: payer.publicKey,   // pays the rent
        newAccountPubkey: mint,        // the new mint's address
        space: MINT_SIZE,              // how big a mint account is
        lamports: mintRent,
        programId: TOKEN_PROGRAM_ID,   // the Token Program will own it
      }),
      createInitializeMint2Instruction(
        mint,
        DECIMALS,
        payer.publicKey,  // mint authority
        null,             // no freeze authority
      ),
    );
  }

  setupTx.add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,  // pays the rent
      userX,            // the account being created
      payer.publicKey,  // who owns the account
      mintX,            // which token it holds
    ),
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      userY,
      payer.publicKey,
      mintY,
    ),
    createMintToInstruction(
      mintX,            // which token to mint
      userX,            // where the new tokens go
      payer.publicKey,  // the mint authority
      USER_START_BALANCE,
    ),
    createMintToInstruction(
      mintY,
      userY,
      payer.publicKey,
      USER_START_BALANCE,
    ),
  );

  // Send it through Anchor's provider, the same way program.methods...rpc()
  // sends the program's instructions. The provider's wallet (the payer) signs,
  // and so do the two mint keypairs, because their accounts are being created.

  await provider.sendAndConfirm(setupTx, [mintXKeypair, mintYKeypair]);

  // The addresses that belong to this pool.

  const { config, lpMint, vaultX, vaultY, treasury, treasuryX, treasuryY } =
    getPoolAddresses(seed, mintX, mintY);

  // The user's LP token account. Only the address is worked out here.
  // The account itself does not exist yet: the first deposit creates it
  // (that is the init_if_needed on user_lp in the program).

  const userLp = getAssociatedTokenAddressSync(lpMint, payer.publicKey);

  return {
    seed, mintX, mintY, config, lpMint, vaultX, vaultY,
    treasury, treasuryX, treasuryY, userX, userY, userLp,
  };
}

// Create the pool on-chain by calling the program's initialize instruction.
// The payer is the initializer (who pays).
//
// authority is the pool's admin, who can lock and unlock it. By default it
// is the payer. Pass null to create a pool with no admin at all.
//
// Test files for the other instructions call this in their before block,
// because they need a pool to exist before they can test anything.

export async function initializePool(
  pool: PoolContext,
  authority: anchor.web3.PublicKey | null = payer.publicKey,
): Promise<void> {
  await program.methods
    .initialize(pool.seed, FEE, PROTOCOL_FEE, authority)
    .accountsPartial({
      initializer: payer.publicKey,
      mintX: pool.mintX,
      mintY: pool.mintY,
      config: pool.config,
      vaultX: pool.vaultX,
      vaultY: pool.vaultY,
      lpMint: pool.lpMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

// Call the program's deposit instruction as the user.
//   lpAmount = how many LP tokens the user wants
//   maxX     = the most token X the user is willing to put in
//   maxY     = the most token Y the user is willing to put in
// The amounts are u64 in Rust, so they are passed as BN (big numbers).
//
// It returns the promise from .rpc(), so a test can either await it
// (expecting it to work) or hand it to expectAmmError (expecting it to fail).

export function depositLiquidity(
  pool: PoolContext,
  lpAmount: number,
  maxX: number,
  maxY: number,
): Promise<string> {
  return program.methods
    .deposit(new anchor.BN(lpAmount), new anchor.BN(maxX), new anchor.BN(maxY))
    .accountsPartial({
      user: payer.publicKey,
      config: pool.config,
      mintX: pool.mintX,
      mintY: pool.mintY,
      vaultX: pool.vaultX,
      vaultY: pool.vaultY,
      userX: pool.userX,
      userY: pool.userY,
      lpMint: pool.lpMint,
      userLp: pool.userLp,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

// Call the program's swap instruction as the user.
//   isX    = true: the user pays in token X and receives Y. false: the reverse.
//   amount = how much the user pays in
//   min    = the least the user will accept back (slippage protection)
//
// Like depositLiquidity, it returns the promise from .rpc().

export function swapTokens(
  pool: PoolContext,
  isX: boolean,
  amount: number,
  min: number,
): Promise<string> {
  return program.methods
    .swap(isX, new anchor.BN(amount), new anchor.BN(min))
    .accountsPartial({
      user: payer.publicKey,
      config: pool.config,
      mintX: pool.mintX,
      mintY: pool.mintY,
      vaultX: pool.vaultX,
      vaultY: pool.vaultY,
      userX: pool.userX,
      userY: pool.userY,
      lpMint: pool.lpMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

// Call the program's withdraw instruction as the user.
//   lpAmount = how many LP tokens the user hands back to be burned
//   minX     = the least token X the user will accept back
//   minY     = the least token Y the user will accept back
//
// Like the other helpers, it returns the promise from .rpc().

export function withdrawLiquidity(
  pool: PoolContext,
  lpAmount: number,
  minX: number,
  minY: number,
): Promise<string> {
  return program.methods
    .withdraw(new anchor.BN(lpAmount), new anchor.BN(minX), new anchor.BN(minY))
    .accountsPartial({
      user: payer.publicKey,
      config: pool.config,
      mintX: pool.mintX,
      mintY: pool.mintY,
      vaultX: pool.vaultX,
      vaultY: pool.vaultY,
      userX: pool.userX,
      userY: pool.userY,
      lpMint: pool.lpMint,
      userLp: pool.userLp,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

// Call the program's lock or unlock instruction.
//
// signer is whoever signs as the authority. By default it is the payer,
// who is the pool's real admin in these tests. A test can pass a different
// keypair to check that a stranger is refused.
//
// The payer always signs and pays the transaction fee through the provider.
// A different signer is added with .signers(), so they sign too.

export function lockPool(
  pool: PoolContext,
  signer: anchor.web3.Keypair = payer,
): Promise<string> {
  return program.methods
    .lock()
    .accountsPartial({ authority: signer.publicKey, config: pool.config })
    .signers(signer === payer ? [] : [signer])
    .rpc();
}

export function unlockPool(
  pool: PoolContext,
  signer: anchor.web3.Keypair = payer,
): Promise<string> {
  return program.methods
    .unlock()
    .accountsPartial({ authority: signer.publicKey, config: pool.config })
    .signers(signer === payer ? [] : [signer])
    .rpc();
}

// Check that a call to the program fails with one particular AmmError.
//   action       = the call that should fail (the promise from .rpc())
//   expectedCode = the name of the error variant, for example "InvalidAmount"
//
// try: wait for the call. If it succeeds, that is wrong, so fail the test.
// catch: check it failed with the expected error, not for some other reason.
// The `failed` flag keeps the two cases apart: without it, the error thrown
// by expect.fail would itself be caught by the catch block.

export async function expectAmmError(
  action: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  let failed = false;

  try {
    await action;
  } catch (err) {
    failed = true;
    expect(err).to.be.instanceOf(anchor.AnchorError);
    expect((err as anchor.AnchorError).error.errorCode.code).to.equal(expectedCode);
  }

  if (!failed) {
    expect.fail(`the call should have failed with ${expectedCode}, but it succeeded`);
  }
}

// Read how many tokens a token account holds, in the smallest unit.
// getAccount reads the account from the validator. Its amount comes back as
// a bigint, which is turned into a normal number so it is easy to compare.

export async function getTokenBalance(
  tokenAccount: anchor.web3.PublicKey,
): Promise<number> {
  const account = await getAccount(provider.connection, tokenAccount);
  return Number(account.amount);
}
