# Spec: lifetime deposit access + uncapped referrals

Written at the end of a long session, for whoever picks this up next.
Nothing here is implemented yet.

## Constants

```
MINT     = B4GQTgdRHi9HvYVYiHhokAfi2YkW99EzL6fshaS6BAGS   ($MEMEOPOLY, live on Bags)
TREASURY = 7yAqGCvGVP7H5o4nXdvoudvY5cn2w2UcTgQ4nhMJKCRM   (verified valid, currently empty)
DEPOSIT  = 500 tokens, one time, grants lifetime access
REFERRAL = 100 tokens, uncapped
```

Put these in env vars (`GATE_MINT`, `TREASURY_ADDRESS`, `DEPOSIT_AMOUNT`,
`REFERRAL_REWARD`), not literals.

## The one rule that must not be broken

**Referral rewards are paid from the reward vault, never from deposit inflow.**

`vault.js` already holds a 1,000,000,000 token reward vault with
`distributeFromVault()`. Use it. Deposits are revenue and stay in the treasury.

Funding referrals out of new entrants' deposits is the structural definition of
a pyramid scheme. Funding them from your own token supply is customer
acquisition cost, which is what Coinbase and Dropbox do. Uncapped is fine under
the second model and not under the first. This is the whole reason uncapped is
acceptable here.

## 1. Deposit verification

Extend `game/server/walletgate.js` (it already does ed25519 signature
verification and server-side RPC reads, with tests in `walletgate.test.js`).

Flow:

1. User connects wallet and signs the existing challenge (proves ownership)
2. User sends >= 500 $MEMEOPOLY to TREASURY
3. Client submits the transaction signature
4. Server calls `getTransaction` and verifies ALL of:
   - mint matches MINT
   - amount >= DEPOSIT
   - destination is TREASURY
   - source wallet == the wallet that signed the challenge
   - transaction is finalized
   - **the signature has not been claimed before**
5. On success, mark the wallet lifetime-paid, permanently

### Non-negotiables

- **Replay protection.** Store every claimed tx signature. One signature grants
  access once. Without this, one payment is shared by everyone.
- **Server-side only.** A client saying "I paid" means nothing.
- **Persist it.** See the storage warning below - if this lives in memory,
  people lose access they paid real money for.

## 2. Referral rewards

Current implementation is broken in three ways (verified by testing, not
assumed):

- `this.referrals` lives on `GameService`, which is **per room and in memory**.
  Counts vanish when a room empties.
- The referrer must be an **active player in the same room**, so a normal
  invite link cannot work.
- The landing page advertises *"earn 10% of their rewards forever"*. **No such
  10% share exists in the code** - only milestone bonuses at 5/10/25 referrals.
  Either implement it or change the copy; it is a false claim as written.

Rebuild as:

- Move referral state into `accounts.js` so it persists per account
- Pay `REFERRAL_REWARD` via `vault.distributeFromVault()`
- **Pay on the referee's first completed game, not on signup.** This is what
  makes bot farming pointless and is the strongest argument that the reward is
  for product use rather than recruitment.
- Uncapped is acceptable given the vault funding + completed-game trigger

## 3. Anti-abuse (currently zero)

Nothing today checks IP, wallet, or device. Uncapped rewards with a live token
and no abuse protection drains the vault. Before any payout ships:

- same-wallet dedup (a wallet cannot refer itself, directly or in a cycle)
- same-IP throttling
- referee must have actually completed a game
- rate limit the deposit-verification endpoint (walletgate already has a
  per-IP limiter to copy)

## 4. Blocking issue: storage

`accounts.json` and `vault.json` are rewritten with `writeFileSync` on every
mutation. There is no database, no locking, no backup. Two concurrent writes
can corrupt the file.

**This must be fixed before taking deposits.** Right now a corrupt write loses
the record of who paid, and there is no way to reconstruct it. People would pay
500 tokens and lose access with no recourse.

Fix storage first. Everything else in this spec is downstream of it.

## Legal notes

- A one-time payment for lifetime product access is a straightforward purchase,
  not an investment contract. This is cleaner than the hold-balance gate.
- Do not add any mechanism that lets deposits be withdrawn, redeemed, or that
  quotes a dollar value for $MEMEOPOLY in the UI. `cashOut()` was removed for
  exactly this reason - see the commit "refactor: remove cash-out vault".
- Disclose the referral reward publicly. Concealment is what turns a marketing
  program into fraud.
- None of this is legal advice.
