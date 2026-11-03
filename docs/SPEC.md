# Radar B3 — SDD compacto (v0.1)

## 0. Constituição
- Um único arquivo HTML, sem build, sem servidor, sem instalador. Abre no navegador do PC ou do celular, ou hospedado (GitHub Pages).
- Dados só da brapi.dev (plano gratuito), buscados no navegador do usuário. Token guardado só no localStorage do navegador.
- Sem dado real disponível → modo SIMULADO, sempre sinalizado na tela. Nunca misturar dado simulado com real.
- Ferramenta de análise, não recomendação. Toda regra de sinal é explícita e ajustável.

## 1. Especificação (o quê / por quê)
Replicar para a B3 as quatro telas do OrderBlock (order-block.com):
- RF-01 Raio-X: trajetória acumulada de todas as ações do universo na janela (5/20/60 pregões), contagem altas × baixas, ranking de setores.
- RF-02 Painel: melhores setups de alta e de baixa, cada um com variação, fluxo (preço × volume), suporte, resistência, zona de order block, entrada/stop/alvo e R:R.
- RF-03 Rotação setorial: gráfico de rotação relativa (RRG) dos setores contra o Ibovespa (BOVA11), com rastro.
- RF-04 Gráfico: candles do papel com zonas de order block ativas, suporte/resistência e MME20.
- RF-05 Configuração: token brapi e universo editável (TICKER:Setor por linha).
- RF-06 Cache de 15 min para economizar a cota (15 mil req/mês no gratuito).

Casos de borda: ticker inexistente/renomeado (pula e lista), 429 (espera e repete), histórico < 25 pregões (descarta), fetch bloqueado (modo simulado).

## 2. Clarificação — decisões
- Fonte: brapi gratuita, diário (3 meses), atraso ~15 min. Sem intraday.
- Sem posições em aberto na B3 à vista → "fluxo" = direção do preço × volume relativo (no lugar de long/short build-up).
- Benchmark: BOVA11.

## 3. Planejamento (regras)
- Order block de alta: último candle de baixa antes de um deslocamento ≥ 1,2×ATR14 em até 3 candles que rompe a máxima dele. Invalida se algum fechamento posterior ficar abaixo da mínima. Baixa: espelho.
- Suporte/resistência: fractais de 3 barras mais próximos; sem fractal → mínima/máxima de 20 pregões.
- Fluxo: volume do dia ÷ média de 20 pregões; > 1,2 = "com volume".
- Score = 0,4·z(ret5) + 0,3·z(ret1) + 0,2·sinal(ret1)·ln(vol rel) + 0,1·tendência(MME20).
- Setup de alta: entrada = topo do OB (ou fechamento), stop = fundo do OB − 0,25·ATR, alvo = resistência. Baixa: espelho.
- RRG: RS = índice do setor (média igual) ÷ BOVA11; RS-Ratio = 100·RS/MME10(RS); RS-Momentum = 100·Ratio/Ratio(t−5).

## 4. Roadmap de refinamento
1. Validar a lista de tickers do Ibovespa atual (alguns mudaram de código em 2025).
2. Backtest das regras de OB/score nos 3 meses disponíveis (ou plano pago para histórico maior).
3. Intraday (plano pago brapi ou outra fonte) para o Raio-X ao vivo.
4. Posições em aberto de opções/futuros (arquivos diários da B3) para o fluxo real.
5. Hospedar no GitHub Pages + rotina agendada para pré-gerar dados.

## v0.3 — Notícias (RF-07 a RF-09)
- RF-07 Coletar manchetes por papel (Google Notícias RSS) de hora em hora; deduplicar por papel + título.
- RF-08 Classificar com FinBERT-PT-BR (gratuito, na nuvem); registrar rótulo, score e confiança.
- RF-09 Avaliar cada notícia contra o retorno anormal de 1/3/5 pregões, com corte das 17h, e mostrar acerto, correlação e acerto por fonte.
- Fora da v0.3: redes sociais (API do X é paga; raspagem viola termos), fatos relevantes da CVM (dados abertos só atualizam semanalmente), ajuste automático de pesos.
- Próximo: com ≥ 30 sinais por horizonte, testar o filtro "setup do Painel + notícia a favor" contra "setup sem notícia".
