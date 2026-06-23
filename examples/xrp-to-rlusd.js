/**
 * XRP -> RLUSD (same-chain, xrpl-testnet).  Run: node examples/xrp-to-rlusd.js [xrpAmount]
 * Requires .env (see .env.example). The wallet needs an RLUSD trustline to receive.
 */
require('dotenv').config();
const { runSwap } = require('../src/swap');
const { tokenBalance } = require('../src/xrplDeposit');

const RLUSD_ISSUER = process.env.RLUSD_ISSUER;
const RLUSD_HEX = '524C555344000000000000000000000000000000'; // "RLUSD"
const RLUSD = `${RLUSD_HEX}.${RLUSD_ISSUER}`;

const xrp = process.argv[2] || '1';
runSwap({
  seed: process.env.XRPL_WALLET_SEED,
  fromToken: 'xrp',
  toToken: RLUSD,
  fromAmount: String(Math.round(Number(xrp) * 1e6)), // drops
  measure: (client, addr) => tokenBalance(client, addr, RLUSD_ISSUER, RLUSD_HEX),
}).catch((e) => console.error(e.response?.data || e.message));
