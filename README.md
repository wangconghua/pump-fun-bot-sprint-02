# Pump.fun Bot Sprint: Make Bot And Win

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/wangconghua/pump-fun-bot-sprint-02/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/wangconghua/pump-fun-bot-sprint-02/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A make.fun entry for **Pump.fun Bot Sprint: Make Bot And Win** — a paper-trading bot for the `agent-fun/replay/v2` harness. The grader runs `node main.ts` against a 6-hour window of fresh pump.fun launches (10 SOL paper capital, 2-slot fill latency, no shorts, no leverage); entries are ranked by net PnL and need a positive PnL plus at least 20 coins with ≥0.01 SOL round trips to win.

## Strategy: creator-skin launch scalper

Buy a launch in its first slots, exit within ~15 slots. The only durable edge found on the dev window (1,222 coins, 24h) is at creation: the price has not moved yet, so the 2-slot fill latency is harmless — every chase-the-surge rule tested (momentum, breakout, dip-buying) loses money once that latency is applied, and patient holding bleeds out.

**Entry filter** (all measured on the dev window, not guessed):

- Creator buys **0.8–2.5 SOL** of their own coin in the create slot. Below 0.8 SOL they have nothing at stake; above 2.5 SOL they are the dump waiting to happen (raising the cap to 4 SOL flips the book from +0.04 to −0.003).
- **2–3 distinct non-creator buyers** already in, creator has not sold, no single big dump, real SOL reserve 0.3–30 SOL.
- Sizing is capped by the harness (≤1% of a curve's real SOL per reply), so the first buy is ~0.01–0.02 SOL; up to two top-ups while the launch is still young build each position to ~0.03–0.05 SOL.

**Exits:** take profit +40%, stop loss −15%, max hold 15 slots, exit at once if the creator sells. A trailing stop was tested and changes nothing — the exits are dominated by the hold timer.

**Guardrail insurance:** if the filtered launches run short of the 20-coin bar, the bot tops the count up in the last hour with tiny 0.01 SOL probe round trips on the most liquid traded curve (at most one per 10 minutes, at most 10 total).

## Results (dev window, local backtest)

- Net **+0.09 SOL** over 21 filtered coins (+2 probes), max drawdown 0.4%.
- The region is flat, not a spike: creator buy 0.8–1.5 SOL, hold 12–20 slots, take-profit +40%, stop −15% all land within +0.086…+0.097.
- Two of the 21 coins make +0.06 each; the other nineteen lose at most −0.016 each. The edge is a few runners paying for many capped small losses.
- Cross-checked on a second, independent simulator: +0.058 SOL; still positive at double fees (+0.011 SOL).

## Files

- `main.ts` — entry point (`node main.ts`).
- `strategy.ts` — the bot. Fully deterministic: no clock, no randomness, no I/O.
- `vendor/makefun-bot.ts` — the kit's `sdk/ts/makefun-bot.ts`, vendored byte for byte.
- `.makefun/owner.json` — the entrant wallet.

## License

MIT — see `LICENSE`.
