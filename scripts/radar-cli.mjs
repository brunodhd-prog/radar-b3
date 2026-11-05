// Radar na linha de comando: roda as MESMAS funções da página (index.html), sem duplicar regras.
// Uso:
//   node scripts/radar-cli.mjs painel   [--mercado b3|cripto] [--demo] [--json]
//   node scripts/radar-cli.mjs analisar PETR4 [--mercado b3|cripto] [--demo] [--json]
//   node scripts/radar-cli.mjs backtest [--h 5|10|20] [--mercado ...] [--demo] [--json]
// Dados: data/b3.json ou data/cripto.json (gerados pela rotina). --demo usa os dados simulados da página.
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const RAIZ = new URL("..", import.meta.url).pathname;
const argv = process.argv.slice(2);
const flag = (n) => argv.includes("--" + n);
const opt = (n, d) => (argv.includes("--" + n) ? argv[argv.indexOf("--" + n) + 1] : d);
const cmd = argv[0], alvo = argv[1] && !argv[1].startsWith("--") ? argv[1].toUpperCase() : null;
const mercado = opt("mercado", "b3") === "cripto" ? "cripto" : "b3";

// 1) carrega as funções puras da página: do início do <script> até "Estado", mais o bloco de backtest/risco
const html = readFileSync(RAIZ + "index.html", "utf8");
const js = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
const corte = (a, b) => { const i = js.indexOf(a), j = js.indexOf(b, i); if (i < 0 || j < 0) throw new Error("marcador não encontrado: " + a); return js.slice(i, j); };
const codigo = corte("/* ===================== Universo padrão", "/* ===================== Estado")
  + corte("/* ===================== Backtest, Time Machine", "function fmtQtd");
const ctx = vm.createContext({ console, Intl, localStorage: undefined });
vm.runInContext(codigo, ctx);
vm.runInContext(`MERCADO=${JSON.stringify(mercado)};`, ctx);
const R = (expr) => vm.runInContext(expr, ctx);

// 2) dados
const arq = RAIZ + (mercado === "cripto" ? "data/cripto.json" : "data/b3.json");
let data;
if (flag("demo")) data = R("gerarDemo(parseUniverso(MK().univ()))");
else if (existsSync(arq)) data = JSON.parse(readFileSync(arq, "utf8"));
else { console.error(`Sem ${arq.replace(RAIZ, "")}. Rode a rotina (scripts/fetch-brapi.mjs) ou use --demo.`); process.exit(2); }
ctx.DATA = data;
const an = R("pontuar(DATA.stocks.filter(s=>s.bars.length>=25).map(analisar))");
ctx.AN = an;
const f = (x, d = 2) => R(`fmt(${x},${d})`), p = (x, d = 2) => R(`pct(${x},${d})`);
const quando = new Date(data.ts || Date.now()).toISOString().slice(0, 16).replace("T", " ");
const fonte = data.fonte === "brapi" ? `brapi ${quando} UTC` : "DADOS SIMULADOS";

function plano(a) {
  const dir = a.tend > 0 ? 1 : -1, pl = dir > 0 ? a.long : a.short, s = data.stocks.find((x) => x.t === a.t);
  ctx.TMARGS = [s.bars, dir, pl.ent, pl.stop, pl.alvo];
  const tm = R("timeMachine(...TMARGS,10,10000)");
  ctx.CK = [{ ...pl, rr: tm ? tm.rr : pl.rr }, dir, tm];
  const ck = R("checarRisco(...CK)");
  return { dir, pl, tm, ck };
}

if (cmd === "painel") {
  const srt = [...an].sort((a, b) => b.score - a.score);
  const alta = srt.filter((a) => a.tend > 0 && a.score > 0).slice(0, 8), baixa = srt.filter((a) => a.tend < 0 && a.score < 0).reverse().slice(0, 8);
  const linhas = (lst) => lst.map((a) => { const { pl, tm, ck } = plano(a);
    return { t: a.t, setor: a.setor, preco: a.c, dia: a.r1, fluxo: a.fluxo, entrada: pl.ent, stop: pl.stop, alvo: pl.alvo, rr: pl.rr,
      simAlvo: tm ? tm.alvo / tm.N : null, risco: ck.ok ? "APROVADO" : "BLOQUEADO", motivos: ck.motivos, qtd: ck.d.qtd }; });
  const out = { mercado, fonte, alta: linhas(alta), baixa: linhas(baixa) };
  if (flag("json")) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
  console.log(`Painel ${mercado.toUpperCase()} · ${fonte}`);
  for (const [nome, l] of [["ALTA", out.alta], ["BAIXA", out.baixa]]) {
    console.log(`\n${nome}`);
    for (const x of l) console.log(`${x.t.padEnd(7)} ${p(x.dia).padStart(8)}  ${x.fluxo.padEnd(13)} ent ${f(x.entrada)} stop ${f(x.stop)} alvo ${f(x.alvo)} R:R 1:${f(x.rr, 1)}  sim.alvo ${x.simAlvo == null ? "—" : f(x.simAlvo * 100, 0) + "%"}  ${x.risco}${x.motivos.length ? " (" + x.motivos.join("; ") + ")" : ""}`);
  }
} else if (cmd === "analisar") {
  const a = an.find((x) => x.t === alvo);
  if (!a) { console.error(`${alvo || "(sem ticker)"} não está no universo ${mercado}.`); process.exit(2); }
  const { dir, pl, tm, ck } = plano(a);
  const out = { t: a.t, setor: a.setor, mercado, fonte, preco: a.c, dia: a.r1, r5: a.r5, r20: a.r20, volRel: a.vr, fluxo: a.fluxo, tendencia: a.tend > 0 ? "acima MME20" : "abaixo MME20",
    score: a.score, suporte: a.suporte, resistencia: a.resist, obAlta: a.obUp && [a.obUp.bot, a.obUp.top], obBaixa: a.obDn && [a.obDn.bot, a.obDn.top],
    plano: { lado: dir > 0 ? "compra" : "venda", entrada: pl.ent, stop: pl.stop, alvo: pl.alvo, rr: pl.rr },
    timeMachine: tm && { alvo: tm.alvo / tm.N, stop: tm.stop / tm.N, nenhum: tm.nenhum / tm.N, rMedio: tm.expect, veredito: tm.veredito.txt },
    risco: { status: ck.ok ? "APROVADO" : "BLOQUEADO", motivos: ck.motivos, qtd: ck.d.qtd, valor: ck.d.valor, perdaNoStop: ck.d.perda } };
  if (flag("json")) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
  console.log(`${a.t} · ${a.setor} · ${fonte}
Preço ${f(a.c)} · dia ${p(a.r1)} · 5p ${p(a.r5)} · 20p ${p(a.r20)} · vol ${f(a.vr, 1)}× · ${out.fluxo} · ${out.tendencia} · score ${f(a.score)}
Suporte ${f(a.suporte)} · Resistência ${f(a.resist)} · OB alta ${out.obAlta ? out.obAlta.map((v) => f(v)).join("–") : "—"} · OB baixa ${out.obBaixa ? out.obBaixa.map((v) => f(v)).join("–") : "—"}
Plano ${out.plano.lado}: entrada ${f(pl.ent)} · stop ${f(pl.stop)} · alvo ${f(pl.alvo)} · R:R 1:${f(pl.rr, 1)}
Time Machine (10.000 × 10 candles): alvo ${tm ? f(tm.alvo / 100, 1) + "%" : "—"} · stop ${tm ? f(tm.stop / 100, 1) + "%" : "—"} · ${tm ? tm.veredito.txt : "histórico insuficiente"}
Risco: ${out.risco.status} · ${out.risco.qtd} un. · R$ ${f(out.risco.valor, 0)} · perda no stop R$ ${f(out.risco.perdaNoStop, 0)}${ck.motivos.length ? " · " + ck.motivos.join("; ") : ""}`);
} else if (cmd === "backtest") {
  ctx.H = Number(opt("h", 10));
  const bt = R("rodarBacktest(DATA,H)");
  const res = bt.res.map(({ curva, ...r }) => ({ ...r, veredito: r.veredito.txt }));
  if (flag("json")) { console.log(JSON.stringify({ mercado, fonte, H: bt.H, estrategias: res }, null, 1)); process.exit(0); }
  console.log(`Backtest ${mercado.toUpperCase()} · ${fonte} · prazo ${bt.H} candles · sem custos`);
  for (const r of res) console.log(`${r.nome.padEnd(25)} n=${String(r.n).padStart(4)}  acerto ${r.acerto == null ? "  —" : f(r.acerto * 100, 0).padStart(3) + "%"}  média ${r.expect == null ? "—" : f(r.expect, 2) + " R"}  total ${f(r.totalR, 1)} R  PF ${r.pf == null ? "—" : f(r.pf, 2)}  queda ${f(r.dd, 1)} R  → ${r.veredito}`);
} else {
  console.log("Comandos: painel | analisar TICKER | backtest   (opções: --mercado b3|cripto --demo --json --h N)");
  process.exit(cmd ? 2 : 0);
}
