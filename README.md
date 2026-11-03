# Radar de Blocos B3

Painel de ações da B3 (order blocks, fluxo, rotação setorial). Página única (`index.html`) + rotina na nuvem que busca a brapi.

## Como os dados chegam
1. `.github/workflows/brapi.yml` roda a cada 15 min de pregão (e manualmente em Actions → Run workflow).
2. `scripts/fetch-brapi.mjs` lê `BRAPI_TOKEN` do ambiente, chama `GET /api/v2/stocks/historical` (até 20 símbolos por chamada, em sequência, `range=3mo`, `interval=1d`) e grava `data/b3.json`.
3. A página lê `data/b3.json`. Ela nunca recebe a chave. Sem o arquivo, mostra dados simulados e avisa.

## Configuração (uma vez)
- Repositório → Settings → Secrets and variables → Actions → New repository secret: `BRAPI_TOKEN` = sua chave da brapi.
- Settings → Pages → Deploy from branch `main`, pasta `/ (root)`.
- Ações acompanhadas: `data/universo.txt` (TICKER:Setor).

## Teste local
`BRAPI_TOKEN=... node scripts/fetch-brapi.mjs --symbols PETR4,VALE3`
(PETR4, VALE3, MGLU3 e ITUB4 respondem também sem chave.)

Tratamento de erros: 401 interrompe (chave inválida); 403 interrompe (plano); 404 refaz o lote ticker a ticker e lista o que falhou; 429 espera o `Retry-After` (até 4 tentativas); barras com OHLC null são descartadas e volume null vira 0; tickers renomeados são resolvidos e listados.
