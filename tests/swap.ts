import { expect } from "chai";
import {
  depositLiquidity,
  expectAmmError,
  FEE,
  getTokenBalance,
  initializePool,
  ONE_TOKEN,
  PoolContext,
  setupPool,
  swapTokens,
} from "./helpers/setup";

describe("swap", () => {

  // This file's own pool, separate from the pools in the other test files.

  let pool: PoolContext;

  // Before the tests: build the mints and the user's token accounts,
  // create the pool, then put liquidity in it. A swap needs tokens in the
  // vaults to trade against, so the pool starts with 100 X and 200 Y.

  before(async () => {
    pool = await setupPool(20);
    await initializePool(pool);
    await depositLiquidity(pool, 100 * ONE_TOKEN, 100 * ONE_TOKEN, 200 * ONE_TOKEN);
  });

  // Read all four balances that a swap changes, in one go.
  // Each test reads them before and after the swap and compares.

  async function getBalances() {
    return {
      vaultX: await getTokenBalance(pool.vaultX),
      vaultY: await getTokenBalance(pool.vaultY),
      userX: await getTokenBalance(pool.userX),
      userY: await getTokenBalance(pool.userY),
    };
  }

  // Work out how much a swap should pay out, with the same formula the
  // program uses. It works for both directions:
  //   reserveIn  = how much the pool holds of the token being paid in
  //   reserveOut = how much the pool holds of the token being paid out
  //
  // 1. Take the fee off the amount paid in (FEE is in basis points).
  // 2. amountOut = reserveOut * inAfterFee / (reserveIn + inAfterFee)
  //
  // Dividing BigInts drops any remainder, which rounds down, the same as
  // the program. Rounding down means the pool never pays out too much.

  function expectedSwapOut(amountIn: number, reserveIn: number, reserveOut: number): number {
    const inAfterFee = (BigInt(amountIn) * BigInt(10_000 - FEE)) / BigInt(10_000);
    const out = (BigInt(reserveOut) * inAfterFee) / (BigInt(reserveIn) + inAfterFee);
    return Number(out);
  }

  // The user pays in token X and receives token Y.

  it("swaps token X for token Y", async () => {
    const amountIn = 10 * ONE_TOKEN;
    const before = await getBalances();

    // Work out what the user should get back, using the same formula as the
    // program. BigInt is used because the numbers multiplied together are too
    // big for a normal JavaScript number to hold exactly.

    const expectedOut = expectedSwapOut(amountIn, before.vaultX, before.vaultY);

    // min is 0 here: this test is about the amounts, not slippage.

    await swapTokens(pool, true, amountIn, 0);

    const after = await getBalances();

    // The user paid in exactly amountIn of X, and the X vault received it.

    expect(after.userX).to.equal(before.userX - amountIn);
    expect(after.vaultX).to.equal(before.vaultX + amountIn);

    // The user received exactly the expected amount of Y, from the Y vault.

    expect(after.userY).to.equal(before.userY + expectedOut);
    expect(after.vaultY).to.equal(before.vaultY - expectedOut);

    // The fee stays in the pool, so x * y must not have gone down.

    const kBefore = BigInt(before.vaultX) * BigInt(before.vaultY);
    const kAfter = BigInt(after.vaultX) * BigInt(after.vaultY);

    expect(kAfter >= kBefore).to.equal(true);
  });

  // The user pays in token Y and receives token X: the other direction.

  it("swaps token Y for token X", async () => {
    const amountIn = 20 * ONE_TOKEN;
    const before = await getBalances();

    // Same formula, with the reserves the other way round:
    // Y is the token going in, and X is the token coming out.

    const expectedOut = expectedSwapOut(amountIn, before.vaultY, before.vaultX);

    await swapTokens(pool, false, amountIn, 0);

    const after = await getBalances();

    // The user paid in exactly amountIn of Y, and the Y vault received it.

    expect(after.userY).to.equal(before.userY - amountIn);
    expect(after.vaultY).to.equal(before.vaultY + amountIn);

    // The user received exactly the expected amount of X, from the X vault.
    // The fee is taken in this direction too.

    expect(after.userX).to.equal(before.userX + expectedOut);
    expect(after.vaultX).to.equal(before.vaultX - expectedOut);

    // The fee stays in the pool, so x * y must not have gone down.

    const kBefore = BigInt(before.vaultX) * BigInt(before.vaultY);
    const kAfter = BigInt(after.vaultX) * BigInt(after.vaultY);

    expect(kAfter >= kBefore).to.equal(true);
  });

  // Slippage protection. The user pays in 10 X, which is worth roughly 18 Y,
  // but says they will accept no less than 100 Y. The program must refuse.

  it("fails when the user would get back less than their minimum", async () => {
    const before = await getBalances();

    await expectAmmError(
      swapTokens(pool, true, 10 * ONE_TOKEN, 100 * ONE_TOKEN),
      "SlippageExceeded",
    );

    // A failed transaction is undone completely, so nothing should have moved.

    expect(await getBalances()).to.deep.equal(before);
  });

  // Swapping zero tokens makes no sense, so the program must refuse
  // with InvalidAmount.

  it("fails when the user swaps zero tokens", async () => {
    await expectAmmError(
      swapTokens(pool, true, 0, 0),
      "InvalidAmount",
    );
  });

});
