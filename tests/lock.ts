import * as anchor from "@anchor-lang/core";
import { expect } from "chai";
import {
  depositLiquidity,
  expectAmmError,
  initializePool,
  lockPool,
  ONE_TOKEN,
  PoolContext,
  program,
  setupPool,
  swapTokens,
  unlockPool,
  withdrawLiquidity,
} from "./helpers/setup";

describe("lock and unlock", () => {

  // This file's own pool, separate from the pools in the other test files.

  let pool: PoolContext;

  // A stranger: a brand new wallet that is NOT the pool's authority.
  // It is used to check that only the real admin can lock and unlock.
  // It needs no SOL, because the payer still pays the transaction fees.

  const stranger = anchor.web3.Keypair.generate();

  // Before the tests: create the pool (the payer is its authority) and
  // deposit, so there is liquidity to swap against and withdraw.

  before(async () => {
    pool = await setupPool(40);
    await initializePool(pool);
    await depositLiquidity(pool, 100 * ONE_TOKEN, 100 * ONE_TOKEN, 200 * ONE_TOKEN);
  });

  // Read the pool's locked setting from its Config account.

  async function isLocked(): Promise<boolean> {
    const configAccount = await program.account.config.fetch(pool.config);
    return configAccount.locked;
  }

  // A stranger must not be able to freeze someone else's pool.

  it("fails when someone who is not the authority tries to lock", async () => {
    await expectAmmError(lockPool(pool, stranger), "InvalidAuthority");

    expect(await isLocked()).to.equal(false);
  });

  // The pool's real admin locks it.

  it("lets the authority lock the pool", async () => {
    await lockPool(pool);

    expect(await isLocked()).to.equal(true);
  });

  // While the pool is locked, deposit, swap and withdraw must all be refused.
  // Each one checks config.locked at the top and returns PoolLocked.

  it("refuses deposits while locked", async () => {
    await expectAmmError(
      depositLiquidity(pool, 10 * ONE_TOKEN, 20 * ONE_TOKEN, 40 * ONE_TOKEN),
      "PoolLocked",
    );
  });

  it("refuses swaps while locked", async () => {
    await expectAmmError(
      swapTokens(pool, true, 10 * ONE_TOKEN, 0),
      "PoolLocked",
    );
  });

  it("refuses withdrawals while locked", async () => {
    await expectAmmError(
      withdrawLiquidity(pool, 10 * ONE_TOKEN, 0, 0),
      "PoolLocked",
    );
  });

  // A stranger must not be able to unlock a pool the admin locked for safety.

  it("fails when someone who is not the authority tries to unlock", async () => {
    await expectAmmError(unlockPool(pool, stranger), "InvalidAuthority");

    expect(await isLocked()).to.equal(true);
  });

  // The admin unlocks the pool, and it works again.

  it("lets the authority unlock the pool", async () => {
    await unlockPool(pool);

    expect(await isLocked()).to.equal(false);

    // A swap goes through again now that the pool is open.

    await swapTokens(pool, true, 10 * ONE_TOKEN, 0);
  });

  // A pool created with no authority has no admin at all.
  // Nobody can lock it, not even the wallet that created it.

  it("fails to lock a pool that has no authority", async () => {
    const openPool = await setupPool(41);
    await initializePool(openPool, null);

    await expectAmmError(lockPool(openPool), "InvalidAuthority");
  });

});
