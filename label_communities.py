import json
import re
from pathlib import Path

from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.build import build_from_json
from graphify.cluster import score_all
from graphify.report import generate


def words_from_label(label: str) -> list[str]:
    label = label or ""
    # Drop bracketed content but keep key acronyms like VN/DNSE/AI.
    label = re.sub(r"\([^)]*\)", " ", label)
    label = label.replace("-", " ")
    # Split camelCase into words.
    label = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", label)
    parts = re.split(r"[^A-Za-z0-9]+", label)
    return [p for p in parts if p]


STOPWORDS = {
    "component",
    "client",
    "service",
    "api",
    "class",
    "function",
    "handler",
    "guard",
    "gate",
    "loading",
    "placeholder",
    "provider",
    "hook",
    "hooks",
    "extract",
    "extractdnse",
    "parse",
    "pick",
    "format",
    "formatting",
    "util",
    "utils",
    "to",
    "use",
    "usehook",
    "usehook",
    "short",
    "long",
    "async",
    "sync",
    "session",
    "workflow",
    "starter",
    "network",
    "server",
    "automation",
    "scheduler",
    "control",
    "graph",
    "report",
    "document",
    "image",
    "paper",
    "video",
    "rationale",
    "risk",
    "news",
    "signals",
    "toast",
    "table",
    "rows",
    "row",
}


PHRASE_HINTS = [
    (["dnse", "gateway", "data"], "DNSE Gateway Data Shaping"),
    (["dnse", "cash"], "DNSE Cash Extraction"),
    (["holdings", "dnse"], "DNSE Holdings Extraction"),
    (["symbol", "ai", "analysis"], "Symbol Analysis with AI"),
    (["chart", "price", "lightweightcharts"], "Price Chart Rendering"),
    (["watchlist"], "Watchlist Client"),
    (["toast"], "Toast Feedback Workflow"),
    (["automation", "scheduler"], "Automation Scheduler Control"),
    (["monitoring", "risk"], "Risk Event Monitoring"),
    (["signals", "monitoring"], "Signals & Monitoring"),
]


def make_label(cid: int, node_ids: list[str], node_map: dict[str, str]) -> str:
    labels = [node_map.get(nid, "") for nid in node_ids]
    all_text = " ".join(labels).lower()

    for keys, hint in PHRASE_HINTS:
        if all(k in all_text for k in keys):
            return hint

    token_counts: dict[str, int] = {}
    for lab in labels:
        for w in words_from_label(lab):
            wl = w.lower()
            if len(wl) < 2:
                continue
            if wl in STOPWORDS:
                continue
            token_counts[wl] = token_counts.get(wl, 0) + 1

    sorted_tokens = sorted(token_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    top = [t for t, _ in sorted_tokens][:10]

    def cap(tok: str) -> str:
        up = tok.upper()
        if up in {"VN", "DNSE", "AI", "HTTP", "QR", "URL", "UI"}:
            return up
        if up == "VNSTOCK":
            return "VNStock"
        return tok.capitalize()

    chosen: list[str] = []
    for t in top:
        chosen.append(cap(t))
        if len(chosen) >= 3:
            break

    if len(chosen) < 2:
        # Fallback: keep something stable rather than empty.
        return f"Community {cid}"

    return " ".join(chosen[:5])


def main() -> None:
    extract = json.loads(Path(".graphify_extract.json").read_text(encoding="utf-8"))
    detection = json.loads(Path(".graphify_detect.json").read_text(encoding="utf-8"))
    analysis = json.loads(Path(".graphify_analysis.json").read_text(encoding="utf-8"))

    G = build_from_json(extract)
    communities = {int(k): v for k, v in analysis["communities"].items()}
    cohesion = {int(k): v for k, v in analysis["cohesion"].items()}

    # Node id -> human label
    node_map = {n["id"]: n.get("label", "") for n in extract.get("nodes", [])}

    labels: dict[int, str] = {}
    for cid, node_ids in communities.items():
        labels[cid] = make_label(cid, node_ids, node_map)

    # Regenerate the report using real community names.
    suggested_questions = suggest_questions(G, communities, labels)
    report = generate(
        G,
        communities,
        cohesion,
        labels,
        god_nodes(G),
        surprising_connections(G, communities),
        detection,
        {"input": extract.get("input_tokens", 0), "output": extract.get("output_tokens", 0)},
        "INPUT_PATH",
        suggested_questions=suggested_questions,
    )

    Path(".graphify_labels.json").write_text(
        json.dumps({str(k): v for k, v in labels.items()}, indent=2), encoding="utf-8"
    )
    Path("graphify-out/GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    print("Report regenerated with labeled communities:", len(labels))


if __name__ == "__main__":
    main()

