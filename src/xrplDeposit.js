/**
 * xrplDeposit.js — sign and submit the XRPL Payment that Squid returns as the deposit.
 *
 * The Payment object (route.transactionRequest.data) already targets Squid's deposit address
 * and carries the order id in its Memo. Do NOT modify the Memo: the filler matches on it.
 */
const xrpl = require('xrpl');

const RPC_URL = process.env.XRPL_RPC_URL || 'wss://s.altnet.rippletest.net:51233';

function walletFromSeed(seed) {
  return xrpl.Wallet.fromSeed(seed);
}

/** Sign `payment` with `wallet` and submit it. Returns { hash, result }. */
async function submitDeposit(client, wallet, payment) {
  const prepared = await client.autofill(payment);
  const signed = wallet.sign(prepared);
  const res = await client.submitAndWait(signed.tx_blob);
  const code = res.result.meta?.TransactionResult;
  if (code !== 'tesSUCCESS') throw new Error(`deposit failed: ${code}`);
  return { hash: res.result.hash, result: res.result };
}

/** Trustline balance of `currencyHex` issued by `issuer`, held by `address` (0 if none). */
async function tokenBalance(client, address, issuer, currencyHex) {
  const r = await client.request({ command: 'account_lines', account: address, peer: issuer });
  const line = (r.result.lines || []).find((l) => l.currency.toUpperCase() === currencyHex.toUpperCase());
  return line ? parseFloat(line.balance) : 0;
}

/** Native XRP balance (in XRP) of `address`. */
async function xrpBalance(client, address) {
  const r = await client.request({ command: 'account_info', account: address, ledger_index: 'validated' });
  return Number(r.result.account_data.Balance) / 1e6;
}

module.exports = { xrpl, RPC_URL, walletFromSeed, submitDeposit, tokenBalance, xrpBalance };
