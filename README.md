# squid-xrpl-swap

Squid same-chain swap reference for **XRP ↔ RLUSD on XRPL** ([Squid](https://www.squidrouter.com/) Intents, UAT + xrpl-testnet).

A minimal, single-file TypeScript reference (`swap.ts`) that runs one swap end to end:
quote → sign & submit the deposit Payment → trigger status / poll for fill.

> Testnet only. The wallets and issuer used are throwaway testnet values (zero real value). Do not reuse on mainnet.

## Flow

```
1. POST /v2/route   -> route.transactionRequest.data is a ready XRPL Payment (+ order-id Memo)
2. sign that Payment with the XRPL wallet seed and submit it on-chain (do NOT touch the Memo)
3. GET /v2/status   -> with quoteId (route.requestId) AND transactionId (deposit hash)
4. poll the receive-side balance until the swapped token arrives (~10-15s)
```

### ⚠️ xrpl-testnet has no automatic deposit pickup

Unlike EVM chains, Squid does not auto-detect XRPL testnet deposits. After submitting the deposit you must call `GET /v2/status` with **both** `quoteId` and `transactionId` to trigger the filler.

- `transactionId` only → `404 No transaction found`
- `quoteId` only → `400 transactionId is required for non-Canton chains`

Once called, status moves `awaiting` → `success` and the swapped token lands. Track at `https://uat.coralscan.squidrouter.com/tx/<depositHash>`. Mainnet picks up deposits automatically (no manual trigger).

## Setup

```bash
npm install
cp .env.example .env   # fill ISSUER_ADDRESS and RECIPIENT_SEED (testnet values in the handoff doc)
```

`.env`

```
ISSUER_ADDRESS=   # XRPL testnet RLUSD issuer address
RECIPIENT_SEED=   # wallet that pays + receives (same-chain); must have an RLUSD trustline set
```

## Run

```bash
npm run swap -- xrp2rlusd 1    # 1 XRP  -> RLUSD
npm run swap -- rlusd2xrp 1    # 1 RLUSD -> XRP
npm run typecheck              # tsc --noEmit
```

The amount argument is a **human-readable amount** (`1` = 1 XRP / 1 RLUSD). The code converts it to Squid API
base units internally when calling `/v2/route` (RLUSD `×10^15`, XRP `×10^6` drops). At the XRPL transaction and
balance layer the value stays human-readable (`1`).

## Notes

- API base (UAT): `https://api.uatsquidrouter.com`. Chain: `xrpl-testnet` (same-chain, `fromChain` = `toChain`).
- The receive wallet needs an **RLUSD trustline** to receive RLUSD.
- XRPL token format is `<currencyHex>.<issuer>` (RLUSD = `524C555344000000000000000000000000000000.<issuer>`). Use the RLUSD issuer registered in the Squid token list.
- integrator-id is set in `swap.ts`. For production, get your own from Squid and enable the route.
- Testnet pricing is **mock**; re-verify real rates, slippage, and minimum route size on mainnet.
- Do not commit secrets. `.env` is gitignored; testnet seeds only.
