import { expect } from "chai";
import {
  depositLiquidity,
  expectAmmError,
  getTokenBalance,
  initializePool,
  ONE_TOKEN,
  PoolContext,
  setupPool,
  USER_START_BALANCE,
  withdrawLiquidity,
} from "./helpers/setup";

describe("withdraw", () => {

  // This file's own pool, separate from the pools in the other test files.

  let pool: PoolContext;

  // Before the tests: build the mints and the user's token accounts,
  // create the pool, then deposit. A withdrawal needs something to take out.
  // The pool starts with 100 X and 200 Y, and the user holds 100 LP tokens.

  before(async () => {
    pool = await setupPool(30);
    await initializePool(pool);
    await depositLiquidity(pool, 100 * ONE_TOKEN, 100 * ONE_TOKEN, 200 * ONE_TOKEN);
  });

  // Read every balance that a withdrawal changes, in one go.

  async function getBalances() {
    return {
      vaultX: await getTokenBalance(pool.vaultX),
      vaultY: await getTokenBalance(pool.vaultY),
      userX: await getTokenBalance(pool.userX),
      userY: await getTokenBalance(pool.userY),
      userLp: await getTokenBalance(pool.userLp),
    };
  }

  // The user hands back part of their LP tokens.
  // They hold 100 LP tokens, which is the whole pool. Burning 40 of them
  // is 40% of the pool, so they get back 40% of each token: 40 X and 80 Y.

  it("withdraws part of the user's liquidity", async () => {
    await withdrawLiquidity(pool, 40 * ONE_TOKEN, 0, 0);

    const after = await getBalances();

    // The vaults paid out 40 X and 80 Y: 100 - 40 = 60, and 200 - 80 = 120.

    expect(after.vaultX).to.equal(60 * ONE_TOKEN);
    expect(after.vaultY).to.equal(120 * ONE_TOKEN);

    // The user got those tokens back. They had put in 100 X and 200 Y,
    // so they are now 60 X and 120 Y down from where they started.

    expect(after.userX).to.equal(USER_START_BALANCE - 60 * ONE_TOKEN);
    expect(after.userY).to.equal(USER_START_BALANCE - 120 * ONE_TOKEN);

    // 40 of the user's LP tokens were burned: 100 - 40 = 60 left.

    expect(after.userLp).to.equal(60 * ONE_TOKEN);
  });

  // Slippage protection. Burning 30 LP tokens is worth 30 X and 60 Y,
  // but the user says they will accept no less than 50 X.
  // The program must refuse with SlippageExceeded.

  it("fails when the user would get back less than their minimum", async () => {
    const before = await getBalances();

    await expectAmmError(
      withdrawLiquidity(pool, 30 * ONE_TOKEN, 50 * ONE_TOKEN, 0),
      "SlippageExceeded",
    );

    // A failed transaction is undone completely, so nothing should have moved
    // and no LP tokens should have been burned.

    expect(await getBalances()).to.deep.equal(before);
  });

  // Burning zero LP tokens makes no sense, so the program must refuse
  // with InvalidAmount.

  it("fails when the user withdraws zero LP tokens", async () => {
    await expectAmmError(
      withdrawLiquidity(pool, 0, 0, 0),
      "InvalidAmount",
    );
  });

  // The user hands back all the LP tokens they have left (60).
  // That is the whole pool, so the vaults should be emptied and the user
  // should end up with exactly the tokens they started with.

  it("withdraws all of the user's remaining liquidity", async () => {
    await withdrawLiquidity(pool, 60 * ONE_TOKEN, 0, 0);

    const after = await getBalances();

    // The pool is empty.

    expect(after.vaultX).to.equal(0);
    expect(after.vaultY).to.equal(0);

    // The user has everything back.

    expect(after.userX).to.equal(USER_START_BALANCE);
    expect(after.userY).to.equal(USER_START_BALANCE);

    // All the user's LP tokens have been burned.

    expect(after.userLp).to.equal(0);
  });

});
