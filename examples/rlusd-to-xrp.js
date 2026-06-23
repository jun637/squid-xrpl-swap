/**
 * RLUSD -> XRP (same-chain, xrpl-testnet).  Run: node examples/rlusd-to-xrp.js [rlusdAmount]
 * The wallet needs an RLUSD balance to spend.
 */
require('dotenv').config();
const { runSwap } = require('../src/swap');
const { xrpBalance } = require('../src/xrplDeposit');

const RLUSD_ISSUER = process.env.RLUSD_ISSUER;
const RLUSD_HEX = '524C555344000000000000000000000000000000';
const RLUSD = `${RLUSD_HEX}.${RLUSD_ISSUER}`;

const amount = process.argv[2] || '1';
runSwap({
  seed: process.env.XRPL_WALLET_SEED,
  fromToken: RLUSD,
  toToken: 'xrp',
  fromAmount: String(BigInt(Math.round(Number(amount) * 1e15))), // RLUSD = 15 decimals
  measure: (client, addr) => xrpBalance(client, addr),
}).catch((e) => console.error(e.response?.data || e.message));
