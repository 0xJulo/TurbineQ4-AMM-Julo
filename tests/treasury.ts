import * as anchor from "@anchor-lang/core";
import { expect } from "chai";
import {
  depositLiquidity,
  expectAmmError,
  expectedProtocolCut,
  getTokenBalance,
  initializePool,
  ONE_TOKEN,
  payer,
  PoolContext,
  provider,
  setupPool,
  swapTokens,
  withdrawTreasury,
} from "./helpers/setup";

describe("treasury", () => {

  // This file's own pool, separate from the pools in the other test files.

  let pool: PoolContext;

  // A stranger: a brand new wallet that is NOT the pool's authority.

  const stranger = anchor.web3.Keypair.generate();

  // The two swaps the first test makes, so the later tests know how much
  // the treasury should have collected.

  const swapXAmount = 10 * ONE_TOKEN;
  const swapYAmount = 20 * ONE_TOKEN;

  // Before the tests: create the pool (the payer is its authority) and
  // deposit, so there is liquidity to swap against.
  //
  // The stranger is also given 1 SOL. withdraw_treasury creates the signer's
  // token accounts if they are missing, and the signer pays that rent.
  // Without SOL the stranger's attempt would fail for the wrong reason
  // (not enough SOL) before the authority check is ever reached.

  before(async () => {
    pool = await setupPool(50);
    await initializePool(pool);
    await depositLiquidity(pool, 100 * ONE_TOKEN, 100 * ONE_TOKEN, 200 * ONE_TOKEN);

    const fundStranger = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: stranger.publicKey,
        lamports: anchor.web3.LAMPORTS_PER_SOL,
      }),
    );

    await provider.sendAndConfirm(fundStranger);
  });

  // Every swap sends the protocol's share of its fee to the treasury,
  // in the token that was paid in.

  it("collects a share of the fee from each swap", async () => {

    // A new pool's treasury starts empty.

    expect(await getTokenBalance(pool.treasuryX)).to.equal(0);
    expect(await getTokenBalance(pool.treasuryY)).to.equal(0);

    // One swap in each direction, so the treasury collects both tokens.

    await swapTokens(pool, true, swapXAmount, 0);
    await swapTokens(pool, false, swapYAmount, 0);

    expect(await getTokenBalance(pool.treasuryX)).to.equal(expectedProtocolCut(swapXAmount));
    expect(await getTokenBalance(pool.treasuryY)).to.equal(expectedProtocolCut(swapYAmount));
  });

  // A stranger must not be able to take the protocol's fees.

  it("fails when someone who is not the authority tries to withdraw", async () => {
    await expectAmmError(withdrawTreasury(pool, stranger), "InvalidAuthority");

    // Nothing left the treasury.

    expect(await getTokenBalance(pool.treasuryX)).to.equal(expectedProtocolCut(swapXAmount));
    expect(await getTokenBalance(pool.treasuryY)).to.equal(expectedProtocolCut(swapYAmount));
  });

  // The pool's admin takes the collected fees.
  // In these tests the authority is the payer, who is also the user, so the
  // fees arrive in the same token accounts the user swaps with.

  it("lets the authority withdraw the collected fees", async () => {
    const userXBefore = await getTokenBalance(pool.userX);
    const userYBefore = await getTokenBalance(pool.userY);

    await withdrawTreasury(pool);

    // The authority received exactly what the treasury had collected.

    expect(await getTokenBalance(pool.userX)).to.equal(userXBefore + expectedProtocolCut(swapXAmount));
    expect(await getTokenBalance(pool.userY)).to.equal(userYBefore + expectedProtocolCut(swapYAmount));

    // The treasury is empty again.

    expect(await getTokenBalance(pool.treasuryX)).to.equal(0);
    expect(await getTokenBalance(pool.treasuryY)).to.equal(0);
  });

  // A pool created with no authority has no admin at all,
  // so nobody can withdraw from its treasury.

  it("fails to withdraw from a pool that has no authority", async () => {
    const openPool = await setupPool(51);
    await initializePool(openPool, null);

    await expectAmmError(withdrawTreasury(openPool), "InvalidAuthority");
  });

});
