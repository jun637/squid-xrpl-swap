/**
 * Squid x XRPL same-chain swap — XRP <-> RLUSD on xrpl-testnet (Squid UAT)
 *
 * Flow:
 *   1) POST /v2/route  -> route.transactionRequest.data (= a ready XRPL Payment, order-id in Memo)
 *   2) sign that Payment with the XRPL seed and submit it on-chain (do NOT touch the Memo)
 *   3) GET /v2/status with BOTH quoteId(=route.requestId) AND transactionId(=deposit hash)
 *      -> on xrpl-testnet this is what triggers the filler (no automatic deposit pickup)
 *   4) poll the recipient balance until the swapped token arrives (~10-15s)
 *
 * Run:  npm run swap -- xrp2rlusd 1      # 1 XRP -> RLUSD
 *       npm run swap -- rlusd2xrp 1      # 1 RLUSD -> XRP
 */
import 'dotenv/config';
import axios from 'axios';
import { Client, Wallet, type Payment } from 'xrpl';

const CFG = {
  squidBaseUrl: 'https://api.uatsquidrouter.com', // UAT
  integratorId: 'catalyze-08bd5c09-5882-43a5-9b09-9d04e5ed9b1a',
  slippage: 1.0,
  chain: 'xrpl-testnet',
  xrplRpc: 'wss://s.altnet.rippletest.net:51233',
  XRP: 'xrp', // Squid native XRP identifier
  rlusdCurrencyHex: '524C555344000000000000000000000000000000', // "RLUSD" as 40-char hex
  pollMs: 4000,
  timeoutMs: 5 * 60_000,
} as const;

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`env ${key} 누락 (.env 확인)`);
  return v;
}

const ISSUER_ADDRESS = requireEnv('ISSUER_ADDRESS'); // testnet RLUSD issuer
const RECIPIENT_SEED = requireEnv('RECIPIENT_SEED'); // wallet that pays + receives (same-chain)
const RLUSD = `${CFG.rlusdCurrencyHex}.${ISSUER_ADDRESS}`; // Squid token id: currencyHex.issuer

type Direction = 'xrp2rlusd' | 'rlusd2xrp';

interface SquidRoute {
  requestId?: string;
  estimate?: {
    toAmount?: string;
    toToken?: { symbol?: string };
    exchangeRate?: string;
    aggregatePriceImpact?: string;
  };
  transactionRequest?: { data: Payment; requestId?: string };
}

interface SquidStatus {
  id?: string;
  status?: string;
  squidTransactionStatus?: string;
  coralTransactionUrl?: string;
}

async function getQuote(args: {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  address: string;
}): Promise<SquidRoute> {
  const body = {
    fromChain: CFG.chain,
    toChain: CFG.chain, // same-chain: from === to
    fromToken: args.fromToken,
    toToken: args.toToken,
    fromAmount: args.fromAmount,
    fromAddress: args.address,
    toAddress: args.address,
    slippage: CFG.slippage,
  };
  const res = await axios.post<{ route?: SquidRoute }>(`${CFG.squidBaseUrl}/v2/route`, body, {
    headers: { 'x-integrator-id': CFG.integratorId, 'Content-Type': 'application/json' },
  });
  const route = res.data?.route;
  if (!route?.transactionRequest?.data) {
    throw new Error('route.transactionRequest.data 없음: ' + JSON.stringify(res.data).slice(0, 400));
  }
  return route;
}

// xrpl-testnet has no automatic deposit pickup. The /status call is the manual trigger.
// XRPL (non-Canton) requires BOTH quoteId(=route requestId) and transactionId(deposit hash):
//   quoteId only      -> "transactionId is required for non-Canton chains"
//   transactionId only -> "No transaction found"
async function getStatus(args: { transactionId: string; quoteId: string }): Promise<SquidStatus> {
  const res = await axios.get<SquidStatus>(`${CFG.squidBaseUrl}/v2/status`, {
    params: {
      transactionId: args.transactionId,
      quoteId: args.quoteId,
      fromChainId: CFG.chain,
      toChainId: CFG.chain,
    },
    headers: { 'x-integrator-id': CFG.integratorId },
  });
  return res.data;
}

async function rlusdBalance(client: Client, addr: string): Promise<number> {
  const r = await client.request({ command: 'account_lines', account: addr, peer: ISSUER_ADDRESS });
  const line = (r.result.lines || []).find(
    (l) => l.currency.toUpperCase() === CFG.rlusdCurrencyHex.toUpperCase(),
  );
  return line ? parseFloat(line.balance) : 0;
}

async function xrpBalance(client: Client, addr: string): Promise<number> {
  const r = await client.request({ command: 'account_info', account: addr, ledger_index: 'validated' });
  return Number(r.result.account_data.Balance) / 1e6;
}

async function run(direction: Direction, humanAmount: string): Promise<void> {
  const wallet = Wallet.fromSeed(RECIPIENT_SEED);
  const addr = wallet.address;

  let fromToken: string;
  let toToken: string;
  let fromAmount: string;
  let measure: (client: Client, addr: string) => Promise<number>;

  if (direction === 'xrp2rlusd') {
    fromToken = CFG.XRP;
    toToken = RLUSD;
    fromAmount = String(Math.round(Number(humanAmount) * 1e6)); // XRP drops (6 decimals)
    measure = rlusdBalance;
  } else if (direction === 'rlusd2xrp') {
    fromToken = RLUSD;
    toToken = CFG.XRP;
    fromAmount = String(BigInt(Math.round(Number(humanAmount) * 1e15))); // RLUSD 15 decimals
    measure = xrpBalance;
  } else {
    throw new Error('direction = xrp2rlusd | rlusd2xrp');
  }

  const client = new Client(CFG.xrplRpc);
  await client.connect();
  try {
    console.log(`\n[1/3] 견적: ${humanAmount} ${direction === 'xrp2rlusd' ? 'XRP -> RLUSD' : 'RLUSD -> XRP'}`);
    const route = await getQuote({ fromToken, toToken, fromAmount, address: addr });
    const quoteId = route.requestId || route.transactionRequest?.requestId;
    if (!quoteId) throw new Error('quoteId(requestId) 없음');
    const est = route.estimate ?? {};
    console.log(
      `    예상 수령(raw)= ${est.toAmount} ${est.toToken?.symbol ?? ''} | rate=${est.exchangeRate} | impact=${est.aggregatePriceImpact}`,
    );

    const before = await measure(client, addr);
    console.log(`    수취 전 잔액= ${before}`);

    console.log('[2/3] deposit Payment 서명 + 제출...');
    const payment = route.transactionRequest!.data; // 완성된 XRPL Payment (Memo = order-id, 수정 금지)
    const prepared = await client.autofill(payment);
    const signed = wallet.sign(prepared);
    const sub = await client.submitAndWait(signed.tx_blob);
    const meta = sub.result.meta;
    const code = typeof meta === 'object' && meta ? (meta as { TransactionResult?: string }).TransactionResult : undefined;
    console.log(`    deposit tx= ${sub.result.hash} | result= ${code}`);
    if (code !== 'tesSUCCESS') throw new Error(`deposit 실패: ${code}`);

    console.log(`[3/3] /status 호출(xrpl-testnet 수동 트리거) + fill 폴링... quoteId=${quoteId}`);
    const t0 = Date.now();
    let lastStatus = '';
    while (Date.now() - t0 < CFG.timeoutMs) {
      await new Promise((r) => setTimeout(r, CFG.pollMs));
      const sec = Math.round((Date.now() - t0) / 1000);
      try {
        const st = await getStatus({ transactionId: sub.result.hash, quoteId });
        const s = st.status || st.squidTransactionStatus || JSON.stringify(st).slice(0, 80);
        if (s !== lastStatus) {
          console.log(`    [status] ${s}`);
          lastStatus = s;
        }
      } catch (e) {
        const err = e as { response?: { status?: number }; message?: string };
        const m = err.response?.status ? `HTTP ${err.response.status}` : (err.message ?? 'err');
        if (m !== lastStatus) {
          console.log(`    [status] (err: ${m})`);
          lastStatus = m;
        }
      }
      const now = await measure(client, addr);
      if (now > before) {
        console.log(`\n✅ fill 도착: +${now - before} (${sec}초). 최종 잔액= ${now}`);
        console.log(`   depositTx= ${sub.result.hash}`);
        return;
      }
      process.stdout.write(`    ...${sec}초\r`);
    }
    console.log(
      `\n⚠️ ${CFG.timeoutMs / 60000}분 내 fill 미도착. depositTx= ${sub.result.hash} 를 Squid에 전달해 확인 필요`,
    );
  } finally {
    await client.disconnect();
  }
}

const [, , dir = 'xrp2rlusd', amt = '1'] = process.argv;
run(dir as Direction, amt).catch((e) => {
  const err = e as { response?: { data?: unknown }; message?: string };
  console.error('ERROR:', err.response?.data ?? err.message);
  process.exit(1);
});
