"""Coleta notícias por ação (Google Notícias RSS), classifica o sentimento com FinBERT-PT-BR e
avalia cada notícia contra o retorno anormal (papel − BOVA11) de 1, 3 e 5 pregões.

Saída: data/noticias.json (acumulativo, 120 dias). Roda na nuvem (GitHub Actions), sem chave.
Uso:  python scripts/noticias.py                # coleta + classifica + avalia
      python scripts/noticias.py --rss-dir DIR  # lê RSS locais (testes)  --sem-modelo usa classificador de teste
"""
from __future__ import annotations
import argparse, email.utils, hashlib, json, re, time, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone, date
from pathlib import Path
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

RAIZ = Path(__file__).resolve().parent.parent
SP = ZoneInfo("America/Sao_Paulo")
MODELO = "lucas-leme/FinBERT-PT-BR"
CORTE_HORA = 17          # notícia a partir das 17h (Brasília) conta para o pregão seguinte
LIMIAR = 0.30            # |score| mínimo para virar sinal avaliado
RETENCAO_DIAS = 120
UA = "RadarB3/1.0 (+github actions)"


# ---------------- universo ----------------
def ler_universo(txt: str):
    out, vistos = [], set()
    for ln in txt.splitlines():
        m = re.match(r"^([A-Za-z0-9]{2,7})\s*[:;,\t]\s*(.+)$", ln.strip())
        if not m:
            continue
        t = m.group(1).upper()
        if t in vistos:
            continue
        vistos.add(t)
        partes = [p.strip() for p in m.group(2).split(":")]
        out.append({"t": t, "setor": partes[0], "nome": partes[1] if len(partes) > 1 else t})
    return out


def dobrar(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s.lower()) if not unicodedata.combining(c))


# ---------------- coleta ----------------
def url_busca(t: str, nome: str, mercado: str = "b3") -> str:
    # cripto: tickers curtos (ADA, DOT, UNI, LINK) são palavras comuns; busca só pelo nome
    q = f'"{nome}" when:2d' if mercado == "cripto" else f'"{t}" OR ({nome}) when:2d'
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q, "hl": "pt-BR", "gl": "BR", "ceid": "BR:pt-419"})


def baixar(url: str, tent: int = 0) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:  # 429/503 do Google: espera e tenta de novo
        if tent < 2:
            time.sleep(5 * (tent + 1))
            return baixar(url, tent + 1)
        raise RuntimeError(f"falha ao baixar RSS: {e}") from e


def parse_rss(xml: str, t: str, nome: str):
    """Itens relevantes: título contém o ticker ou a 1ª palavra do nome de busca."""
    chave = dobrar(nome.split()[0]) if nome else ""
    out = []
    try:
        raiz = ET.fromstring(xml)
    except ET.ParseError:
        return out
    for it in raiz.iter("item"):
        titulo = (it.findtext("title") or "").strip()
        fonte = (it.findtext("source") or "").strip()
        if fonte and titulo.endswith(" - " + fonte):
            titulo = titulo[: -len(" - " + fonte)].strip()
        if not titulo:
            continue
        tf = dobrar(titulo)
        tem_ticker = len(t) >= 5 and re.search(rf"\b{re.escape(t.lower())}\b", tf)
        if not tem_ticker and not (len(chave) >= 3 and re.search(rf"\b{re.escape(chave)}\b", tf)):
            continue
        try:
            pub = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "")
            if pub.tzinfo is None:
                pub = pub.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue
        link = (it.findtext("link") or "").strip()
        nid = hashlib.sha1(f"{t}|{dobrar(titulo)}".encode()).hexdigest()[:16]
        out.append({"id": nid, "t": t, "titulo": titulo, "fonte": fonte or "Google Notícias", "link": link,
                    "pub": pub.astimezone(timezone.utc).isoformat()})
    return out


# ---------------- sessão efetiva (sem olhar o futuro) ----------------
def sessao_efetiva(pub_iso: str, mercado: str = "b3") -> str:
    """Pregão em que a notícia pode afetar o preço pela 1ª vez. Feriados são tratados na avaliação
    (o próximo candle existente na série é usado)."""
    if mercado == "cripto":  # 24/7, candle diário em UTC: conta a partir do dia seguinte (nunca o candle já em curso)
        return (datetime.fromisoformat(pub_iso).astimezone(timezone.utc).date() + timedelta(days=1)).isoformat()
    local = datetime.fromisoformat(pub_iso).astimezone(SP)
    d = local.date()
    if local.hour >= CORTE_HORA:
        d += timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.isoformat()


# ---------------- sentimento ----------------
class FinBERT:
    def __init__(self):
        import torch
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        self.torch = torch
        self.tok = AutoTokenizer.from_pretrained(MODELO)
        self.mod = AutoModelForSequenceClassification.from_pretrained(MODELO).eval()
        cfg = {int(k): v.upper() for k, v in (self.mod.config.id2label or {}).items()}
        # o card do modelo documenta 0=POSITIVE, 1=NEGATIVE, 2=NEUTRAL; usa o config se ele trouxer nomes reais
        self.rot = cfg if set(cfg.values()) >= {"POSITIVE", "NEGATIVE"} else {0: "POSITIVE", 1: "NEGATIVE", 2: "NEUTRAL"}

    def __call__(self, textos):
        res = []
        for i in range(0, len(textos), 16):
            lote = textos[i:i + 16]
            x = self.tok(lote, return_tensors="pt", padding=True, truncation=True, max_length=128)
            with self.torch.no_grad():
                p = self.torch.softmax(self.mod(**x).logits, dim=-1).tolist()
            for probs in p:
                d = {self.rot[j]: probs[j] for j in range(len(probs))}
                score = d.get("POSITIVE", 0) - d.get("NEGATIVE", 0)
                rot = max(d, key=d.get)
                res.append({"rotulo": {"POSITIVE": "pos", "NEGATIVE": "neg"}.get(rot, "neu"), "score": round(score, 3), "conf": round(max(probs), 3)})
        return res


def classificador_teste(textos):
    pos, neg = ("lucro", "alta", "sobe", "recorde", "dispara", "aprova"), ("queda", "cai", "prejuízo", "multa", "rebaixa", "despenca")
    out = []
    for t in textos:
        f = dobrar(t)
        s = sum(w in f for w in pos) - sum(dobrar(w) in f for w in neg)
        sc = max(-1, min(1, s * 0.6))
        out.append({"rotulo": "pos" if sc > 0 else "neg" if sc < 0 else "neu", "score": sc, "conf": 0.9 if s else 0.5})
    return out


# ---------------- avaliação ----------------
def avaliar(itens, b3, tz=SP):
    """Retorno anormal (ativo − referência) do fechamento anterior à sessão efetiva até k candles depois."""
    if not b3:
        return
    def serie(s):
        return [(datetime.fromtimestamp(b["d"], tz).date().isoformat(), b["c"]) for b in s["bars"]]
    bench = serie(b3["bench"])
    bmap = dict(bench)
    papeis = {s["t"]: serie(s) for s in b3["stocks"]}
    for it in itens:
        s = papeis.get(it["t"])
        if not s:
            continue
        idx = next((i for i, (d, _) in enumerate(s) if d >= it["sessao"]), None)
        if idx is None or idx == 0:
            continue
        d0, c0 = s[idx - 1]
        b0 = bmap.get(d0)
        for k in (1, 3, 5):
            j = idx - 1 + k
            if j < len(s) and b0:
                dk, ck = s[j]
                bk = bmap.get(dk)
                if bk:
                    it[f"r{k}"] = round((ck / c0 - 1) - (bk / b0 - 1), 5)


# ---------------- principal ----------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rss-dir")
    ap.add_argument("--sem-modelo", action="store_true")
    ap.add_argument("--out", default=str(RAIZ / "data/noticias.json"))
    a = ap.parse_args()

    univ = [dict(u, mercado="b3") for u in ler_universo((RAIZ / "data/universo.txt").read_text(encoding="utf-8"))]
    cp = RAIZ / "data/cripto.txt"
    if cp.exists():
        univ += [dict(u, mercado="cripto") for u in ler_universo(cp.read_text(encoding="utf-8"))]
    saida = Path(a.out)
    hist = json.loads(saida.read_text(encoding="utf-8")) if saida.exists() else {"itens": []}
    por_id = {it["id"]: it for it in hist.get("itens", [])}

    novos, falhas = [], []
    for u in univ:
        try:
            xml = (Path(a.rss_dir) / f"{u['t']}.xml").read_text(encoding="utf-8") if a.rss_dir else baixar(url_busca(u["t"], u["nome"], u["mercado"]))
        except Exception as e:
            falhas.append(f"{u['t']}: {e}")
            continue
        for it in parse_rss(xml, u["t"], u["nome"]):
            if it["id"] not in por_id:
                it["mercado"] = u["mercado"]
                it["sessao"] = sessao_efetiva(it["pub"], u["mercado"])
                novos.append(it)
                por_id[it["id"]] = it
        if not a.rss_dir:
            time.sleep(1.0)  # educado com o Google

    if novos:
        clf = classificador_teste if a.sem_modelo else FinBERT()
        for it, r in zip(novos, clf([n["titulo"] for n in novos])):
            it.update(r)

    limite = (datetime.now(timezone.utc) - timedelta(days=RETENCAO_DIAS)).isoformat()
    itens = sorted((i for i in por_id.values() if i["pub"] >= limite and "score" in i), key=lambda i: i["pub"], reverse=True)

    for merc, arq, tz in (("b3", "data/b3.json", SP), ("cripto", "data/cripto.json", timezone.utc)):
        pth = RAIZ / arq
        if pth.exists():
            avaliar([i for i in itens if i.get("mercado", "b3") == merc], json.loads(pth.read_text(encoding="utf-8")), tz)

    out = {"ts": int(time.time() * 1000), "modelo": "teste" if a.sem_modelo else MODELO, "limiar": LIMIAR,
           "corte_hora": CORTE_HORA, "itens": itens, "falhas": falhas}
    saida.parent.mkdir(parents=True, exist_ok=True)
    saida.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"OK: {len(novos)} novas, {len(itens)} no histórico, {len(falhas)} falhas de coleta.")
    for f in falhas[:10]:
        print(" -", f)


if __name__ == "__main__":
    main()
