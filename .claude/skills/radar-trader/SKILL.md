---
name: radar-trader
description: Use quando Bruno perguntar sobre o Radar de Blocos (B3 ou Cripto), um ticker da B3 ou uma criptomoeda, setups, backtest, Time Machine, risco ou tamanho de posição, ou quando ele pedir uma das skills trader-* (day-trader) — decide entre o Radar (diário, B3 e cripto) e o pacote day-trader (intraday, ações dos EUA) e combina os dois.
---

# Radar + Day Trader

Dois motores convivem neste repositório. Escolha pelo mercado e pelo tempo gráfico, nunca pelos dois ao mesmo tempo sem dizer qual número veio de qual.

| Pergunta | Use | Por quê |
|---|---|---|
| Ação da B3 (PETR4, VALE3…) | Radar (`scripts/radar-cli.mjs`) | Dados diários da brapi. As skills trader-* têm o pregão de Nova York (9h30–16h) fixo no código e descartam os dias da B3. |
| Criptomoeda, visão diária | Radar com `--mercado cripto` | Dados diários em BRL da brapi; referência BTC. |
| Criptomoeda, intraday | `trader-timemachine` / `trader-entry` com `BTC-USD`, `ETH-USD` | Funciona só dentro da janela de Nova York; avise isso na resposta. |
| Ação americana | Pacote trader-* completo | É o mercado para o qual ele foi feito. |
| Balanço de empresa americana, Congresso dos EUA | `trader-analyst`, `trader-pelosi` | Fontes SEC e Câmara dos EUA. Não existe equivalente B3 aqui. |
| Enviar ordem | `trader-broker` (Alpaca, paper por padrão) | Só EUA. Para B3 e cripto no Brasil não há corretora conectada: nunca simule que uma ordem foi enviada. |

## Radar na linha de comando

As funções são as mesmas da página (`index.html`), carregadas dela; nenhuma regra é duplicada.

```bash
node scripts/radar-cli.mjs painel                       # setups de alta e baixa + APROVADO/BLOQUEADO
node scripts/radar-cli.mjs analisar PETR4               # plano, order blocks, Time Machine, risco
node scripts/radar-cli.mjs backtest --h 10              # 4 estratégias + base aleatória, walk-forward
node scripts/radar-cli.mjs analisar SOL --mercado cripto
# --json para saída estruturada · --demo para dados simulados (diga isso na resposta)
```

Dados: `data/b3.json` e `data/cripto.json`, gerados pela rotina do GitHub (`scripts/fetch-brapi.mjs`, chave em `BRAPI_TOKEN`). Se o arquivo não existir, diga que a rotina ainda não rodou; não troque por `--demo` sem avisar.

Parâmetros de risco do Radar: os padrões da página (capital R$ 10.000, 1% por operação, posição máx. 30%, R:R mínimo 1,5). Se Bruno informar outros valores, use-os e diga quais usou.

## Como combinar

1. **B3**: `radar-cli analisar` → leia o plano e o veredito do Time Machine → confira o backtest da estratégia que gerou o setup (`backtest`) contra a **Base aleatória**. Estratégia que não bate a base não tem vantagem; diga isso primeiro.
2. **Cripto**: Radar para o diário; se Bruno quiser entrada intraday, rode `trader-entry`/`trader-timemachine` com o par `-USD` e deixe claro que a janela é a de Nova York e que o preço é em dólar, não em reais.
3. **EUA**: siga o fluxo do pacote (scanner → news → entry → exit → timemachine → budget → risk → broker), cada skill com o seu SKILL.md.

## Regras

- Marque confiança: `[Certo]` para números saídos das ferramentas, `[Provável]` para inferências, `[Chute]` para lacunas.
- Dados simulados, amostra < 20 operações ou 3 meses de diário: diga que não há conclusão estatística.
- O backtest do Radar não desconta custos nem escorregamento; o real tende a ser pior.
- Não é recomendação de investimento. Nunca envie ordem sem o "sim" explícito de Bruno na conversa.
- Créditos: skills trader-* de Jake Schincariol (MIT, `../DAY-TRADER-LICENSE.txt`), sem alterações.
