"""Summarize the final protocol, retaining earlier pilot requests for cost/audit visibility."""
from collections import defaultdict
import json
from pathlib import Path
import statistics

from run import HERE, bridge, fidelity, samples


def usable(row):
    version = row.get("experiment_version", 1)
    if row["method"] in ["local", "local_plain"]:
        return version >= 3
    return version >= 2 or not (row["method"] == "thinking" and row["sample"] == "long")


def main():
    all_rows = list(map(json.loads, (HERE/"results.jsonl").read_text().splitlines()))
    selected = {}
    for row in all_rows:
        if usable(row):
            selected[row["sample"], row["method"], row["repeat"]] = row
    grouped = defaultdict(list)
    corpus = samples()
    for row in selected.values():
        row["fidelity"] = fidelity(corpus[row["sample"]], row["output"])
        row["content_preserved"] = row["restore_ok"] and not any(row["fidelity"][key] for key in
                                                                  ["missing_content", "missing_math", "missing_frontmatter"])
        if row["method"] in ["protected", "thinking"]:
            p = bridge(corpus[row["sample"]])
            raw = row["calls"][0]["text"]
            positions = [raw.find(token) for token, _ in p["parts"]]
            source_order = sorted(p["parts"], key=lambda item: p["input"].find(item[0]))
            exact = all(raw.count(token) == 1 for token, _ in p["parts"])
            row["protection_diagnostic"] = dict(all_parts_exact_once=exact,
                part_order_changed=exact and [token for token, _ in source_order] !=
                sorted([token for token, _ in source_order], key=raw.find))
        grouped[row["sample"],row["method"]].append(row)
    summary = []
    for (sample, method), rows in sorted(grouped.items()):
        def mean(values):
            values = [value for value in values if value is not None]
            return round(statistics.mean(values), 3) if values else None
        first = [r["calls"][0].get("first_text_s") for r in rows]
        readable = [(r["calls"][0].get("first_json_item_s") if method.startswith("local") else
                     r.get("first_ordered_readable_s", r["calls"][0].get("readable20_s"))) for r in rows]
        summary.append(dict(sample=sample, method=method, n=len(rows),
                            first_text_s=mean(first), readable_proxy_s=mean(readable),
                            total_s=mean(r["total_s"] for r in rows),
                            input_tokens=mean(r["prompt_tokens"] for r in rows),
                            output_tokens=mean(r["completion_tokens"] for r in rows),
                            total_tokens=mean(r["total_tokens"] for r in rows),
                            exact_success=sum(r["success"] for r in rows),
                            content_preserved=sum(r["content_preserved"] for r in rows),
                            repairs=sum(r["repair"] for r in rows),
                            request_count=sum(len(r["calls"]) for r in rows)))
    usage = {key:sum(r.get(key,0) for r in all_rows) for key in
             ["prompt_tokens","completion_tokens","total_tokens","prompt_cache_hit_tokens","prompt_cache_miss_tokens"]}
    result = dict(selected_trials=len(selected), all_trials_including_pilots=len(all_rows),
                  all_requests_including_pilots=sum(len(r["calls"]) for r in all_rows),
                  all_usage_including_pilots=usage, summary=summary,
                  final_diagnostics=[{k:r[k] for k in ["sample","method","repeat","protection_diagnostic"]}
                                     for r in selected.values() if "protection_diagnostic" in r])
    (HERE/"summary.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__ == "__main__":
    main()
