// Busca o histórico diário do universo na brapi (/api/v2/stocks/historical) e grava data/b3.json.
// Chave: variável de ambiente BRAPI_TOKEN (segredo do GitHub Actions). Nunca vai para o repositório nem para a página.
// Uso: BRAPI_TOKEN=... node scripts/fetch-brapi.mjs [--symbols PETR4,VALE3] [--out data/b3.json]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const BASE = process.env.BRAPI_BASE || "https://brapi.dev"; // sobrescrito só nos testes
const TOKEN = process.env.BRAPI_TOKEN || "";
const BENCH = "BOVA11";
const LOTE = 20;          // máx. de símbolos por chamada
const RANGE = "3mo";      // limite do plano gratuito
const MAX_TENT = 4;

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith("--") ? a.concat([[x.slice(2), arr[i + 1]]]) : a), []));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

export class BrapiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function chamar(path, params, tent = 0) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { Accept: "application/json" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const r = await fetch(url, { headers });
  let body = null;
  try { body = await r.json(); } catch { /* corpo vazio ou não-JSON */ }
  const msg = body?.message || body?.error?.message || (typeof body?.error === "string" ? body.error : "") || r.statusText;
  if (r.status === 429) {
    if (tent >= MAX_TENT) throw new BrapiError(429, `cota ou limite simultâneo esgotado após ${MAX_TENT} tentativas: ${msg}`);
    const ra = Number(r.headers.get("retry-after"));
    const espera = Number.isFinite(ra) && ra >= 0 ? ra : 2 ** tent * 2;
    console.warn(`429 — aguardando ${espera}s (Retry-After) …`);
    await sleep(espera * 1000);
    return chamar(path, params, tent + 1);
  }
  if (r.status === 401) throw new BrapiError(401, `chave ausente ou inválida (BRAPI_TOKEN): ${msg}`);
  if (r.status === 403) throw new BrapiError(403, `o plano não inclui estes dados: ${msg}`);
  if (r.status === 404) throw new BrapiError(404, msg || "não encontrado");
  if (!r.ok) throw new BrapiError(r.status, msg);
  return body;
}

// Normaliza um item de results[] tolerando as variações documentadas e campos null.
export function normalizar(item) {
  const sym = item?.symbol || item?.requestedSymbol;
  const serie = item?.data?.historicalDataPrice ?? item?.historicalDataPrice ?? item?.data?.prices ?? item?.prices ?? [];
  const bars = [];
  for (const p of Array.isArray(serie) ? serie : []) {
    const o = num(p?.open), h = num(p?.high), l = num(p?.low), c = num(p?.close ?? p?.adjustedClose);
    if (o === null || h === null || l === null || c === null) continue; // barra incompleta é descartada
    const d = typeof p.date === "number" ? p.date : Math.floor(Date.parse(p.date) / 1000);
    if (!Number.isFinite(d)) continue;
    bars.push({ d, o, h, l, c, v: num(p?.volume) ?? 0 });
  }
  bars.sort((a, b) => a.d - b.d);
  const nome = item?.data?.shortName ?? item?.shortName ?? item?.data?.longName ?? item?.longName ?? sym;
  const renome = item?.changed && item?.requestedSymbol && item?.symbol && item.requestedSymbol !== item.symbol
    ? { de: item.requestedSymbol, para: item.symbol } : null;
  return { pedido: item?.requestedSymbol || sym, t: sym, nome, bars, renome, erro: item?.error ? (item?.message || String(item.error)) : null };
}

async function lote(symbols) {
  const body = await chamar("/api/v2/stocks/historical", { symbols: symbols.join(","), range: RANGE, interval: "1d", sortOrder: "asc" });
  return (body?.results ?? []).map(normalizar);
}

export async function buscarTodos(lista) {
  const ok = new Map(), falhas = [], renomes = [];
  for (let i = 0; i < lista.length; i += LOTE) { // sequencial: plano gratuito aceita 1 requisição simultânea
    const grupo = lista.slice(i, i + LOTE);
    let res;
    try { res = await lote(grupo); }
    catch (e) {
      if (e.status === 401 || e.status === 403) throw e;
      if (e.status === 404 && grupo.length > 1) { // lote recusado por um ticker: refaz um a um
        res = [];
        for (const s of grupo) {
          try { res.push(...(await lote([s]))); }
          catch (e2) { if (e2.status === 401 || e2.status === 403) throw e2; falhas.push(`${s}: ${e2.status || ""} ${e2.message}`.trim()); }
        }
      } else { grupo.forEach((s) => falhas.push(`${s}: ${e.status || ""} ${e.message}`.trim())); continue; }
    }
    for (const r of res) {
      if (r.renome) renomes.push(r.renome);
      if (r.erro) { falhas.push(`${r.pedido}: ${r.erro}`); continue; }
      if (r.bars.length < 25) { falhas.push(`${r.pedido}: histórico curto (${r.bars.length} pregões)`); continue; }
      ok.set(r.pedido, r);
    }
    for (const s of grupo) if (!ok.has(s) && !falhas.some((f) => f.startsWith(s + ":"))) falhas.push(`${s}: sem dados na resposta`);
  }
  return { ok, falhas, renomes };
}

export function parseUniverso(txt) {
  const out = [], seen = new Set();
  for (const ln of txt.split(/\r?\n/)) {
    const m = ln.trim().match(/^([A-Za-z0-9]{4,7})\s*[:;,\t]\s*(.+)$/);
    if (!m) continue;
    const t = m[1].toUpperCase(); if (seen.has(t)) continue; seen.add(t);
    const [setor, nome] = m[2].split(":").map((x) => x.trim());
    out.push({ t, setor, nome: nome || t });
  }
  return out;
}

async function main() {
  if (!TOKEN && !args.symbols) console.warn("BRAPI_TOKEN não definida: só PETR4, MGLU3, VALE3 e ITUB4 respondem sem chave.");
  if (args.symbols) { // modo teste: imprime a resposta normalizada
    const { ok, falhas, renomes } = await buscarTodos(args.symbols.split(",").map((s) => s.trim().toUpperCase()));
    for (const r of ok.values()) {
      const u = r.bars.at(-1);
      console.log(`${r.t} (${r.nome}): ${r.bars.length} pregões · último ${new Date(u.d * 1000).toISOString().slice(0, 10)} O ${u.o} H ${u.h} L ${u.l} C ${u.c} V ${u.v}`);
    }
    if (falhas.length) console.log("Falhas:", falhas);
    if (renomes.length) console.log("Renomeados:", renomes);
    return;
  }
  const univ = parseUniverso(await readFile(new URL("../data/universo.txt", import.meta.url), "utf8"));
  const setorDe = new Map(univ.map((u) => [u.t, u.setor]));
  const { ok, falhas, renomes } = await buscarTodos([BENCH, ...univ.map((u) => u.t)]);
  const bench = ok.get(BENCH);
  if (!bench) throw new Error(`${BENCH} indisponível — sem benchmark não há rotação setorial. Falhas: ${falhas.join("; ")}`);
  const stocks = [...ok.values()].filter((r) => r.pedido !== BENCH)
    .map((r) => ({ t: r.t, nome: r.nome, setor: setorDe.get(r.pedido) || "Outros", bars: r.bars }));
  const out = { fonte: "brapi", ts: Date.now(), bench: { t: BENCH, nome: bench.nome, setor: "Índice", bars: bench.bars }, stocks, falhas, renomes };
  const arq = args.out || new URL("../data/b3.json", import.meta.url).pathname;
  await mkdir(dirname(arq), { recursive: true });
  await writeFile(arq, JSON.stringify(out));
  console.log(`OK: ${stocks.length} ações + ${BENCH} → ${arq}. Falhas: ${falhas.length}. Renomeados: ${renomes.length}.`);
  if (falhas.length) console.log(falhas.join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`ERRO${e.status ? " " + e.status : ""}: ${e.message}`); process.exit(1); });
}
