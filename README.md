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

## Notícias e sentimento (gratuito)
- `.github/workflows/noticias.yml` roda de hora em hora nos dias úteis (8h41–20h41 de Brasília) e uma vez por dia no fim de semana.
- `scripts/noticias.py` busca o Google Notícias por ticker e nome (coluna 3 de `data/universo.txt`), classifica as manchetes com o FinBERT-PT-BR (`lucas-leme/FinBERT-PT-BR`, CPU) e grava `data/noticias.json` (120 dias).
- Sentimento = P(positivo) − P(negativo), de −1 a +1. Sinal = |sentimento| ≥ 0,30.
- Sem olhar o futuro: notícia a partir das 17h, ou de fim de semana, conta para o pregão seguinte. O retorno medido é anormal (papel − BOVA11), a partir do fechamento anterior a esse pregão, em 1, 3 e 5 pregões.
- Aba Notícias: acerto por horizonte, correlação sentimento × retorno, diferença entre positivas e negativas, acerto por fonte. Os cartões do Painel ganham o selo "notícias ±" quando há sinal nos últimos 3 pregões.
- Teste sem rede: `python scripts/noticias.py --rss-dir pasta_com_TICKER.xml --sem-modelo`.
- Não ajuste pesos com menos de ~30 sinais avaliados por horizonte.

## Cripto
- Seletor B3 | Cripto no topo. A escolha fica salva no navegador.
- `node scripts/fetch-brapi.mjs --mercado cripto` chama `GET /api/v2/crypto?coin=...&currency=BRL&range=3mo&interval=1d` e grava `data/cripto.json`. Universo em `data/cripto.txt` (19 moedas). O BTC é a referência da rotação setorial e do retorno anormal.
- A rotina roda cripto também no fim de semana (a cada 2 h). Notícias de cripto são buscadas pelo nome (tickers como ADA, DOT e UNI são palavras comuns) e contam a partir do candle UTC do dia seguinte.
- Quantidade fracionária, sem lote. Operações de venda em cripto só fazem sentido se a sua corretora permitir vender a descoberto ou operar derivativos.

## Backtest, Time Machine e risco
- Aba Backtest: 4 estratégias + base aleatória, walk-forward (cada dia usa só candles até ele), entrada na abertura seguinte, stop testado antes do alvo, prazo de 5/10/20 candles. Mostra acerto, média em R, total, fator de lucro, queda máxima e veredito.
- Gráfico: Time Machine com 10.000 caminhos sorteados dos candles diários do próprio ativo (semente 19), leque de 5–95%, chance de alvo/stop e histórico do ativo no backtest.
- Configurar: capital, risco por operação, posição máxima, R:R mínimo, lote e vantagem mínima na simulação. Os cartões do Painel mostram quantidade, valor, perda no stop e APROVADO/BLOQUEADO com o motivo.
- Sem corretagem e sem escorregamento: o resultado real tende a ser pior. 3 meses de dados diários não bastam para conclusão estatística.
