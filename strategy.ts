// Creator-skin launch scalper for the pump.fun bonding-curve replay (agent-fun/replay/v2).
//
// Thesis, measured on this kit's dev window (1,222 coins, 24h, first 6h traded):
//   - The only durable edge found on this tape is at creation: buy a launch in its
//     first slots, exit within ~15 slots at +40% or -15%. A 2-slot fill latency kills
//     every chase-the-surge rule (the same +50%/-15% rule goes from +3.1 SOL at zero
//     latency to -2.5 SOL at 2 slots), and patient holding bleeds out (mature
//     momentum entries lose -3.6 SOL held to completion). At creation the price has
//     not moved yet, so latency is harmless.
//   - Not every launch is worth buying. The filter that separates them is the
//     creator's own money: a creator who buys 0.8-2.5 SOL of their own coin in the
//     create slot is committed; below 0.8 SOL they have nothing at stake, above
//     2.5 SOL they are the dump waiting to happen (raising the cap to 4 SOL flips
//     the whole book from +0.04 to -0.003). Two to three distinct early buyers, no
//     creator sale, and no single big dump complete the rug filter.
//   - On the dev window this filter plus the fast exit nets +0.09 SOL over 21
//     filtered coins (plus a couple of last-hour guardrail probes) with a 0.4%
//     drawdown -- small, but positive across a flat region (creator buy 0.8-1.5 SOL,
//     hold 12-20 slots, take-profit +40%, stop -15% all land within +0.086..+0.097),
//     not a single lucky cell. Two of the 21 coins make +0.06 each; the other
//     nineteen bleed at most -0.016 each, so the edge is a few runners paying for
//     many capped small losses -- the expected value is positive only if the final
//     window holds a similar runner rate, and the downside is bounded by the exits.
// Sizing is capped by the harness itself: at most 1% of a curve's real SOL per reply,
// so a fresh curve only takes ~0.01-0.02 SOL at first; top-ups while the launch is
// still young build each position to at least 0.02 SOL, which is also what the
// guardrail's 0.01-SOL minimum round trip needs. New entries stop after 6h of block
// time (the final window is 6h); exits keep running. Guardrail probes top the coin
// count up toward 22 if the filtered launches run short.
//
// Deterministic by construction: no clock, no randomness, no I/O; iteration only over
// insertion-ordered maps fed by the batch stream, so the two graded executions agree.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Youngest age (slots since create) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** Lamports to aim for per coin in total. */
  stakeLamports: number;
  /** Smallest single buy worth paying the tx fee for. */
  minBuyLamports: number;
  /** Buys after the first one, each on a later batch, while the coin keeps qualifying. */
  maxAdds: number;
  /** An add needs the price at least this far (bps) above the previous buy's decision price. */
  addStepBps: number;
  /** An add waits this many slots after the previous buy was decided. */
  addDelay: number;
  /** Lamports per add. */
  addLamports: number;
  /** An add needs the recent net flow at least this (lamports). */
  addMinFlowLamports: number;
  /** Real SOL reserve window at decision time (lamports). */
  minRealSol: number;
  maxRealSol: number;
  /** Creator's own buys in the create slot: lamports window. */
  minDevBuy: number;
  maxDevBuy: number;
  /** Trades seen and distinct (non-creator) buyers seen before entry. */
  minTrades: number;
  minBuyers: number;
  /** Distinct non-creator buyers before entry, at most: a launch bundled by many wallets is a dump in waiting. */
  maxBuyers: number;
  /** Lamports sold by others / lamports bought, as bps, at most. */
  maxSellRatioBps: number;
  /** Largest single non-creator sell seen, as bps of the real SOL reserve before it, at most. */
  maxBigSellBps: number;
  /** Price now over the create price, as bps: window. */
  minRunupBps: number;
  maxRunupBps: number;
  /** The recent-flow window (slots) and what it must show. */
  flowWindow: number;
  minFlowLamports: number;
  minRecentBuyers: number;
  /** Creator sold before entry: skip the coin. */
  skipDevSold: boolean;
  /** Slippage allowed on buys (bps). */
  buySlippageBps: number;
  /** Exit when the position is worth this much over its cost (bps). */
  tpBps: number;
  /** Exit when it is worth this much under its cost (bps). */
  slBps: number;
  /** Trailing stop arms once value is this far over cost (bps); 1000000 = off. */
  trailArmBps: number;
  /** ...and exits when value falls this far under its peak (bps). */
  trailBps: number;
  /** Exit after this many slots held. */
  maxHold: number;
  /** Exit at once when the creator sells (after the position opened). */
  exitOnDevSell: boolean;
  /** Exit when no trade has been seen for this many slots; 1000000 = off. */
  staleSlots: number;
  /** Exit when recent net flow falls below this (lamports); 1e15 = off. */
  exitFlowLamports: number;
  /** Block seconds after the first batch during which new entries are allowed. */
  windowSeconds: number;
  /**
   * Guardrail pacing: the run needs at least 20 coins with >=0.01 SOL round trips.
   * In the last hour of the window, top the qualified-coin count up toward this
   * (a small buffer over the 20-coin bar) with tiny probe round trips (buy
   * probeSol, sell it all as soon as the buy lands) until back on pace.
   */
  targetCoins: number;
  probeSol: number;
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 10,
  stakeLamports: 100_000_000,
  minBuyLamports: 5_000_000,
  maxAdds: 2,
  addStepBps: 0,
  addDelay: 2,
  addLamports: 50_000_000,
  addMinFlowLamports: 0,
  minRealSol: 300_000_000,
  maxRealSol: 30_000_000_000,
  minDevBuy: 800_000_000,
  maxDevBuy: 2_500_000_000,
  minTrades: 0,
  minBuyers: 2,
  maxBuyers: 3,
  maxSellRatioBps: 10_000,
  maxBigSellBps: 10_000,
  minRunupBps: 0,
  maxRunupBps: 1_000_000,
  flowWindow: 10,
  minFlowLamports: -1_000_000_000_000,
  minRecentBuyers: 0,
  skipDevSold: true,
  buySlippageBps: 10_000,
  tpBps: 4000,
  slBps: 1500,
  trailArmBps: 1_000_000,
  trailBps: 2000,
  maxHold: 15,
  exitOnDevSell: true,
  staleSlots: 1_000_000,
  exitFlowLamports: 1_000_000_000_000,
  windowSeconds: 21_600,
  targetCoins: 22,
  probeSol: 0.01,
  maxProbes: 1,
};

const BPS = 10_000n;
const LAMPORTS = 1e9;
const FEE_BPS = 125n;

interface Tick {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** The create-time reserves: the price run-up is measured against them. */
  vq0: bigint;
  vt0: bigint;
  devBuy: bigint;
  trades: number;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  bigSellBps: bigint;
  devSold: boolean;
  lastTradeSlot: number;
  /** Trades of the last flowWindow slots (older ones dropped as new ones come). */
  recent: Tick[];
  buysSent: number;
  spentSent: bigint;
  /** Decision price (vq/vt as a pair) of the last buy sent. */
  lastBuyVq: bigint;
  lastBuyVt: bigint;
  lastBuySlot: number;
  /** Never buy it again (exited, filtered out for good, or completed). */
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  txPaid: bigint;
  best: bigint;
  devSoldAtOpen: boolean;
}

/** What selling `tokens` against (vq, vt) would pay after the 1.25% curve fee. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Bot {
  const P = params;
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Mints with a sell in flight. */
  const selling = new Set<Pubkey>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  const stake = BigInt(P.stakeLamports);
  const minBuy = BigInt(P.minBuyLamports);
  let firstTime: number | null = null;
  let nowTime = 0;
  /** Lamports bought per mint, all buys counted: a mint qualifies for the guardrail once this reaches 0.01 SOL. */
  const boughtLamports = new Map<Pubkey, bigint>();
  /** Distinct mints with a completed >=0.01 SOL round trip (buys >= 0.01 SOL). */
  let qualifiedCoins = 0;
  /** Block time of the last probe buy sent, and how many probes have been sent. */
  let lastProbeTime = -1_000_000;
  let probesSent = 0;
  /** Mints already probed: a repeat probe on the same mint adds no new coin. */
  const probedMints = new Set<Pubkey>();

  function readEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          mint: e.mint,
          createSlot: e.slot,
          creator: e.creator,
          vq0: BigInt(e.virtual_quote_reserves),
          vt0: BigInt(e.virtual_token_reserves),
          devBuy: 0n,
          trades: 0,
          buyers: new Set(),
          bought: 0n,
          soldByOthers: 0n,
          bigSellBps: 0n,
          devSold: false,
          lastTradeSlot: e.slot,
          recent: [],
          buysSent: 0,
          spentSent: 0n,
          lastBuyVq: 0n,
          lastBuyVt: 1n,
          lastBuySlot: 0,
          done: false,
          complete: false,
        });
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c === undefined) continue;
        const sol = BigInt(e.sol_amount);
        c.trades += 1;
        c.lastTradeSlot = e.slot;
        c.recent.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user });
        const isDev = e.user === c.creator;
        if (e.is_buy) {
          c.bought += sol;
          if (isDev && e.slot === c.createSlot) c.devBuy += sol;
          else if (!isDev) c.buyers.add(e.user);
        } else if (isDev) {
          c.devSold = true;
        } else {
          c.soldByOthers += sol;
          const rqBefore = BigInt(e.real_quote_reserves) + sol;
          if (rqBefore > 0n) {
            const bps = (sol * BPS) / rqBefore;
            if (bps > c.bigSellBps) c.bigSellBps = bps;
          }
        }
      } else {
        const c = coins.get(e.mint);
        if (c !== undefined) {
          c.complete = true;
          c.done = true;
        }
      }
    }
  }

  /** Net lamports bought minus sold and the distinct buyers, over the last flowWindow slots. */
  function flow(c: Coin, slot: number): { net: bigint; buyers: number } {
    const from = slot - P.flowWindow;
    let drop = 0;
    while (drop < c.recent.length && c.recent[drop]!.slot <= from) drop++;
    if (drop > 0) c.recent.splice(0, drop);
    let net = 0n;
    const buyers = new Set<Pubkey>();
    for (const t of c.recent) {
      if (t.isBuy) {
        net += t.sol;
        if (t.user !== c.creator) buyers.add(t.user);
      } else net -= t.sol;
    }
    return { net, buyers: buyers.size };
  }

  function hasPendingBuy(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'buy') return true;
    return false;
  }

  function hasPendingSell(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'sell') return true;
    return false;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      readEvents(batch);
      for (const e of batch.events) {
        if (e.block_time === null) continue;
        if (firstTime === null) firstTime = e.block_time;
        if (e.block_time > nowTime) nowTime = e.block_time;
      }
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });

      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        if (f.status === 'filled' && f.side === 'sell' && probes.has(f.mint)) {
          // A probe round trip completed: its 0.01 SOL buy counts toward the
          // guardrail's 20-coin bar, so it counts toward the pace target too.
          qualifiedCoins++;
        }
        if (f.status === 'filled' && f.side === 'buy' && !probes.has(f.mint)) {
          const c = coins.get(f.mint);
          if (c !== undefined) {
            const total = (boughtLamports.get(f.mint) ?? 0n) + BigInt(f.quote_lamports);
            boughtLamports.set(f.mint, total);
            if (total >= 10_000_000n && total - BigInt(f.quote_lamports) < 10_000_000n) qualifiedCoins++;
          }
        }
        const h = held.get(f.mint);
        if (f.status !== 'rejected' && h !== undefined) h.txPaid += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
          held.set(f.mint, { openedSlot: f.slot, txPaid: BigInt(f.tx_fee_lamports), best: 0n, devSoldAtOpen: coins.get(f.mint)?.devSold ?? false });
        }
      }
      for (const mint of [...selling]) if (!hasPendingSell(state, mint)) selling.delete(mint);
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPendingBuy(state, mint)) held.delete(mint);
      }
      for (const mint of [...probes.keys()]) {
        const pos = state.positions.get(mint);
        if (pos === undefined && !hasPendingBuy(state, mint) && !hasPendingSell(state, mint)) probes.delete(mint);
      }

      // Exits first.
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint) || probes.has(mint)) continue;
        const c = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot, txPaid: tx, best: 0n, devSoldAtOpen: c?.devSold ?? false };
          held.set(mint, h);
        }
        let mk = marks.get(mint);
        if (mk === undefined) {
          const cv = state.curves.get(mint);
          if (cv === undefined) continue;
          mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
        }
        const value = sellValue(BigInt(pos.token_amount), mk.vq, mk.vt) - tx;
        const basis = BigInt(pos.cost_lamports) + h.txPaid;
        if (value > h.best) h.best = value;
        let exit = false;
        if (basis > 0n) {
          if (value * BPS >= basis * (BPS + BigInt(P.tpBps))) exit = true;
          if (value * BPS <= basis * (BPS - BigInt(P.slBps))) exit = true;
          if (h.best * BPS >= basis * (BPS + BigInt(P.trailArmBps)) && value * BPS <= h.best * (BPS - BigInt(P.trailBps))) exit = true;
        }
        if (state.slot - h.openedSlot >= P.maxHold) exit = true;
        if (c !== undefined) {
          if (P.exitOnDevSell && c.devSold && !h.devSoldAtOpen) exit = true;
          if (state.slot - c.lastTradeSlot >= P.staleSlots) exit = true;
          if (flow(c, state.slot).net < -BigInt(P.exitFlowLamports)) exit = true;
        }
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
        if (c !== undefined) c.done = true;
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, sellingProbe] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!hasPendingBuy(state, mint) && !hasPendingSell(state, mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || hasPendingBuy(state, mint) || hasPendingSell(state, mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!sellingProbe) probes.set(mint, true);
      }

      // Entries and top-ups.
      let free = state.freeCashLamports();
      const entriesOpen = firstTime === null || nowTime - firstTime < P.windowSeconds;
      let open = state.committedPositionCount();
      const traded = new Set<Pubkey>();
      for (const e of batch.events) if (e.event === 'TradeEvent') traded.add(e.mint);
      for (const c of coins.values()) {
        if (orders.length >= cap) break;
        if (c.done || c.complete) continue;
        const age = state.slot - c.createSlot;
        const isAdd = c.buysSent > 0;
        if (!isAdd && age > P.maxAge) {
          c.done = true;
          continue;
        }
        if (age < P.minAge) continue;
        if (isAdd) {
          if (c.buysSent > P.maxAdds) continue;
          if (!state.positions.has(c.mint) || selling.has(c.mint) || hasPendingBuy(state, c.mint)) continue;
        } else if (!entriesOpen || open >= state.hello.caps.max_open_positions) {
          continue;
        }
        const curve = state.curves.get(c.mint);
        if (curve === undefined || curve.complete) continue;
        if (c.devSold && (P.skipDevSold || isAdd)) {
          if (!isAdd) c.done = true;
          continue;
        }
        const vq = curve.virtual_quote_reserves;
        const vt = curve.virtual_token_reserves;
        if (isAdd) {
          // A top-up while the launch is still young and has not run away: it builds
          // the position past the 0.01 SOL round-trip minimum the guardrail needs.
          if (state.slot - c.lastBuySlot < P.addDelay) continue;
          if (vq * c.lastBuyVt * BPS < c.lastBuyVq * vt * BigInt(10_000 + P.addStepBps)) continue;
          if (flow(c, state.slot).net < BigInt(P.addMinFlowLamports)) continue;
          const maxAdd = state.maxBuyLamports(c.mint);
          const want = BigInt(P.addLamports);
          const amount = want < maxAdd ? want : maxAdd;
          if (amount < minBuy || free < amount + tx) continue;
          orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
          free -= amount + tx;
          c.buysSent += 1;
          c.spentSent += amount;
          c.lastBuyVq = vq;
          c.lastBuyVt = vt;
          c.lastBuySlot = state.slot;
          continue;
        }
        // Rug filter: creator skin in the game, a small real crowd, no dump yet.
        const rq = curve.real_quote_reserves;
        if (rq < BigInt(P.minRealSol) || rq > BigInt(P.maxRealSol)) continue;
        if (c.devBuy < BigInt(P.minDevBuy) || c.devBuy > BigInt(P.maxDevBuy)) continue;
        if (c.trades < P.minTrades || c.buyers.size < P.minBuyers || c.buyers.size > P.maxBuyers) continue;
        if (c.bought > 0n && c.soldByOthers * BPS > c.bought * BigInt(P.maxSellRatioBps)) continue;
        if (c.bigSellBps > BigInt(P.maxBigSellBps)) continue;
        const runup = (vq * c.vt0 * BPS) / (vt * c.vq0);
        if (runup > BigInt(P.maxRunupBps) || runup < BigInt(P.minRunupBps)) continue;
        const fl = flow(c, state.slot);
        if (fl.net < BigInt(P.minFlowLamports) || fl.buyers < P.minRecentBuyers) continue;
        const room = stake - c.spentSent;
        if (room < minBuy) continue;
        const maxBuy = state.maxBuyLamports(c.mint);
        const amount = room < maxBuy ? room : maxBuy;
        if (amount < minBuy) continue;
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        free -= amount + tx;
        c.buysSent += 1;
        c.spentSent += amount;
        c.lastBuyVq = vq;
        c.lastBuyVt = vt;
        c.lastBuySlot = state.slot;
        open += 1;
      }

      // Guardrail pacing: the run needs at least 20 coins with >=0.01 SOL round trips.
      // Probes are last-hour insurance, not a strategy. The filtered launches arrive in
      // bursts, so pacing against a linear target fires probes all window even when the
      // natural count ends up fine (that cost 0.022 SOL in testing). Instead, wait until
      // the last hour, then top the count up toward 22 (a small buffer over the 20-coin
      // bar) at most one probe every 10 minutes of block time, at most 10 in total.
      // Each probe costs ~0.002 SOL in fees and spread, so the cap bounds the damage.
      // The probe buys the most liquid traded curve, where the 0.01 SOL barely moves
      // the price, and sells it all as soon as the buy lands.
      if (probes.size < P.maxProbes && firstTime !== null && entriesOpen && probesSent < 10) {
        const elapsed = nowTime - firstTime;
        if (elapsed >= P.windowSeconds - 3600 && nowTime - lastProbeTime >= 600 && qualifiedCoins < P.targetCoins) {
          const minRq = (BigInt(Math.floor(P.probeSol * LAMPORTS)) * BPS) / BigInt(state.hello.caps.max_order_bps_of_real_reserve);
          let bestMint: Pubkey | null = null;
          let bestRq = 0n;
          for (const mint of traded) {
            if (coins.get(mint)?.done || probes.has(mint) || probedMints.has(mint) || hasPendingBuy(state, mint) || hasPendingSell(state, mint) || state.positions.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (curve.real_quote_reserves < (minRq * 3n) / 2n) continue;
            if (curve.real_quote_reserves > bestRq) {
              bestRq = curve.real_quote_reserves;
              bestMint = mint;
            }
          }
          if (bestMint !== null && orders.length < cap && free >= BigInt(Math.floor(P.probeSol * LAMPORTS)) + 2n * tx) {
            orders.push({ side: 'buy', mint: bestMint, quote_lamports: BigInt(Math.floor(P.probeSol * LAMPORTS)), max_slippage_bps: P.buySlippageBps });
            probes.set(bestMint, false);
            probedMints.add(bestMint);
            probesSent++;
            lastProbeTime = nowTime;
            free -= BigInt(Math.floor(P.probeSol * LAMPORTS)) + tx;
          }
        }
      }
      return orders;
    },
  };
}
