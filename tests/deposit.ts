import * as anchor from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import {
  depositLiquidity,
  expectAmmError,
  getTokenBalance,
  initializePool,
  ONE_TOKEN,
  payer,
  PoolContext,
  program,
  setupPool,
  USER_START_BALANCE,
} from "./helpers/setup";

describe("deposit", () => {

  // This file's own pool, separate from the pools in the other test files.

  let pool: PoolContext;

  // Before the tests: build the mints and the user's token accounts,
  // then create the pool. After this the pool exists but is empty.

  before(async () => {
    pool = await setupPool(10);
    await initializePool(pool);
  });

  // The first deposit into an empty pool.
  // There is no price yet, so the program takes exactly max_x and max_y
  // from the user, and that sets the price.

  it("deposits into an empty pool", async () => {

    // The user asks for 100 LP tokens, and puts in 100 X and 200 Y.
    // X and Y are different amounts on purpose: if the program mixed
    // them up, the checks below would catch it.

    const lpAmount = 100 * ONE_TOKEN;
    const maxX = 100 * ONE_TOKEN;
    const maxY = 200 * ONE_TOKEN;

    // Call deposit. The three arguments are u64 in Rust, so they are
    // passed as BN (big numbers).

    await program.methods
      .deposit(
        new anchor.BN(lpAmount),
        new anchor.BN(maxX),
        new anchor.BN(maxY),
      )
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

    // The vaults should now hold exactly what the user put in.

    expect(await getTokenBalance(pool.vaultX)).to.equal(maxX);
    expect(await getTokenBalance(pool.vaultY)).to.equal(maxY);

    // The user's balances should have gone down by the same amounts.

    expect(await getTokenBalance(pool.userX)).to.equal(USER_START_BALANCE - maxX);
    expect(await getTokenBalance(pool.userY)).to.equal(USER_START_BALANCE - maxY);

    // The user should have received the LP tokens they asked for.
    // This also proves the user's LP token account was created,
    // since it did not exist before this deposit.

    expect(await getTokenBalance(pool.userLp)).to.equal(lpAmount);
  });

  // A second deposit, into a pool that already has liquidity.
  // The pool now has a price (100 X to 200 Y), so the program asks the curve
  // library how much X and Y are needed to keep that same ratio.
  //
  // The pool holds 100 X, 200 Y and 100 LP tokens. The user asks for 50 more
  // LP tokens, which is 50% more than exist. So they must add 50% more of
  // each token: 50 X and 100 Y.

  it("deposits into a pool that already has liquidity", async () => {
    const lpAmount = 50 * ONE_TOKEN;

    // The maximums are set higher than what is needed, to prove the program
    // only takes what the ratio requires and not the full maximum.

    const maxX = 60 * ONE_TOKEN;
    const maxY = 120 * ONE_TOKEN;

    await depositLiquidity(pool, lpAmount, maxX, maxY);

    // The vaults: 100 + 50 = 150 X, and 200 + 100 = 300 Y.

    expect(await getTokenBalance(pool.vaultX)).to.equal(150 * ONE_TOKEN);
    expect(await getTokenBalance(pool.vaultY)).to.equal(300 * ONE_TOKEN);

    // The user has now put in 150 X and 300 Y in total.

    expect(await getTokenBalance(pool.userX)).to.equal(USER_START_BALANCE - 150 * ONE_TOKEN);
    expect(await getTokenBalance(pool.userY)).to.equal(USER_START_BALANCE - 300 * ONE_TOKEN);

    // The user's LP tokens: 100 + 50 = 150.

    expect(await getTokenBalance(pool.userLp)).to.equal(150 * ONE_TOKEN);
  });

  // Slippage protection. The user asks for 50 more LP tokens, which needs
  // about 50 X and 100 Y, but says they will pay at most 10 X.
  // The program must refuse with SlippageExceeded.

  it("fails when the deposit would cost more than the user's maximum", async () => {
    const lpAmount = 50 * ONE_TOKEN;
    const maxX = 10 * ONE_TOKEN;   // far too low on purpose
    const maxY = 120 * ONE_TOKEN;

    await expectAmmError(
      depositLiquidity(pool, lpAmount, maxX, maxY),
      "SlippageExceeded",
    );

    // A failed transaction is undone completely, so nothing should have moved.

    expect(await getTokenBalance(pool.vaultX)).to.equal(150 * ONE_TOKEN);
    expect(await getTokenBalance(pool.vaultY)).to.equal(300 * ONE_TOKEN);
    expect(await getTokenBalance(pool.userLp)).to.equal(150 * ONE_TOKEN);
  });

  // Asking for zero LP tokens makes no sense, so the program must refuse
  // with InvalidAmount.

  it("fails when the user asks for zero LP tokens", async () => {
    await expectAmmError(
      depositLiquidity(pool, 0, 10 * ONE_TOKEN, 10 * ONE_TOKEN),
      "InvalidAmount",
    );
  });

});
