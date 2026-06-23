/**
 * squidClient.js — Squid API wrapper (quote + status).
 *
 * XRPL same-chain swaps (XRP <-> RLUSD) run on Squid Intents. On xrpl-testnet there is
 * no automatic deposit pickup, so after submitting the deposit you MUST call getStatus()
 * with BOTH quoteId and transactionId to trigger the filler.
 */
const axios = require('axios');

const BASE_URL = process.env.SQUID_BASE_URL || 'https://api.uatsquidrouter.com';
const INTEGRATOR_ID = process.env.SQUID_INTEGRATOR_ID;
const CHAIN = process.env.XRPL_CHAIN_ID || 'xrpl-testnet';

function headers() {
  if (!INTEGRATOR_ID) throw new Error('SQUID_INTEGRATOR_ID not set (.env)');
  return { 'x-integrator-id': INTEGRATOR_ID, 'Content-Type': 'application/json' };
}

/** Request a route. Returns { route } where route.transactionRequest.data is a ready XRPL Payment. */
async function getRoute({ fromToken, toToken, fromAmount, address, slippage = 1.0 }) {
  const { data } = await axios.post(`${BASE_URL}/v2/route`, {
    fromChain: CHAIN, toChain: CHAIN, fromToken, toToken, fromAmount,
    fromAddress: address, toAddress: address, slippage,
  }, { headers: headers() });
  if (!data?.route?.transactionRequest?.data) {
    throw new Error('No transactionRequest in route: ' + JSON.stringify(data).slice(0, 300));
  }
  return data.route;
}

/**
 * Query / trigger a swap's status.
 * @param {string} quoteId        route.requestId
 * @param {string} transactionId  the XRPL deposit tx hash
 * Both are required on xrpl-testnet (non-Canton chain). Returns { id, status, coralTransactionUrl, ... }.
 */
async function getStatus({ quoteId, transactionId }) {
  const { data } = await axios.get(`${BASE_URL}/v2/status`, {
    params: { quoteId, transactionId, fromChainId: CHAIN, toChainId: CHAIN },
    headers: { 'x-integrator-id': INTEGRATOR_ID },
  });
  return data;
}

module.exports = { getRoute, getStatus, BASE_URL, CHAIN };
