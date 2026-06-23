# squid-xrpl-swap

Minimal reference for **same-chain XRPL swaps (XRP ↔ RLUSD)** via [Squid](https://www.squidrouter.com/) Intents. Validated end-to-end on `xrpl-testnet`.

## Flow

```
1. POST /v2/route   -> route.transactionRequest.data is a ready XRPL Payment (+ order-id Memo)
2. sign that Payment with the XRPL wallet seed and submit it on-chain
3. GET /v2/status   -> with quoteId (route.requestId) AND transactionId (deposit hash)
4. poll the receive-side balance until the swapped token arrives (~10-15s)
```

### ⚠️ xrpl-testnet has no automatic deposit pickup

Unlike EVM chains, Squid does not auto-detect XRPL testnet deposits. After submitting the deposit you must call `GET /v2/status` with **both** `quoteId` and `transactionId` to trigger the filler.

- `transactionId` only → `404 No transaction found`
- `quoteId` only → `400 transactionId is required for non-Canton chains`

Once called, status moves `awaiting` → `success` and the swapped token lands. Track at `https://uat.coralscan.squidrouter.com/tx/<depositHash>`.

## Usage

```bash
npm install
cp .env.example .env   # fill in SQUID_INTEGRATOR_ID, RLUSD_ISSUER, XRPL_WALLET_SEED
npm run xrp2rlusd -- 1     # 1 XRP  -> RLUSD
npm run rlusd2xrp -- 1     # 1 RLUSD -> XRP
```

## Layout

| File | Role |
|---|---|
| `src/squidClient.js` | `getRoute` (quote) + `getStatus` (trigger/track) |
| `src/xrplDeposit.js` | sign + submit the XRPL Payment, balance helpers |
| `src/swap.js`        | orchestrates quote → deposit → status trigger → poll |
| `examples/*.js`      | XRP↔RLUSD runnable examples |

## Notes

- The receive wallet needs an **RLUSD trustline** to receive RLUSD.
- XRPL token format is `<currencyHex>.<issuer>` (RLUSD = `524C555344000000000000000000000000000000.<issuer>`). Use the RLUSD issuer registered in the Squid token list.
- Testnet pricing is **mock**; re-verify real rates, slippage, and minimum route size on mainnet.
- Do not commit secrets. `.env` is gitignored; testnet seeds only.
