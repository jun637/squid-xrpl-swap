/**
 * swap.js — orchestrate a same-chain XRPL swap end to end.
 *
 *   quote -> sign & submit deposit -> trigger via /status (quoteId + transactionId) -> poll fill
 *
 * `measure` reads the receive-side balance so completion is judged on the ledger, not just the API.
 */
const { getRoute, getStatus } = require('./squidClient');
const { xrpl, RPC_URL, walletFromSeed, submitDeposit } = require('./xrplDeposit');

async function runSwap({ seed, fromToken, toToken, fromAmount, measure, pollMs = 4000, timeoutMs = 5 * 60_000, log = console.log }) {
  const wallet = walletFromSeed(seed);
  const addr = wallet.address;

  log(`[quote] ${fromAmount} ${fromToken} -> ${toToken}`);
  const route = await getRoute({ fromToken, toToken, fromAmount, address: addr });
  const quoteId = route.requestId || route.transactionRequest.requestId;
  log(`[quote] expected out (raw) = ${route.estimate?.toAmount} | rate ${route.estimate?.exchangeRate}`);

  const client = new xrpl.Client(RPC_URL);
  await client.connect();
  try {
    const before = await measure(client, addr);

    log('[deposit] signing + submitting XRPL Payment...');
    const { hash: depositTx } = await submitDeposit(client, wallet, route.transactionRequest.data);
    log(`[deposit] ${depositTx}`);

    log('[status] triggering filler via /status (quoteId + transactionId)...');
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollMs));
      try {
        const st = await getStatus({ quoteId, transactionId: depositTx });
        if (st.status && st.status !== last) { log(`[status] ${st.status}`); last = st.status; }
      } catch (e) {
        const m = e.response?.status ? `HTTP ${e.response.status}` : e.message;
        if (m !== last) { log(`[status] (${m})`); last = m; }
      }
      const now = await measure(client, addr);
      if (now > before) {
        log(`[done] received +${now - before} (${Math.round((Date.now() - t0) / 1000)}s)`);
        return { depositTx, received: now - before, balanceAfter: now };
      }
    }
    throw Object.assign(new Error('fill timed out'), { depositTx });
  } finally {
    await client.disconnect();
  }
}

module.exports = { runSwap };
