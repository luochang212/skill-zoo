"""Offline regression: valid inline reordering plus a missing frontmatter must be repairable."""
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("benchmark", HERE.parent / "translation-benchmark/run.py")
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)
benchmark.build_bridge()
source = "---\nname: example\ndescription: Example description\n---\nUse `a` with `b` on `c`, then `d`."
protected = benchmark.bridge(source)
_, a, b, c, d = [token for token, _ in protected["parts"]]
body = f"使用 {a}，在 {c} 上应用 {b}，然后 {d}。"
prefix = protected["input"][:protected["input"].find(a)]
assert benchmark.bridge(source, raw=prefix + body)["restored"] is not None
plan = benchmark.bridge(source, raw=body)
# An identity translation preserves every requested marker, removing model randomness.
repair = plan["repair_input"].replace("=== FRAGMENT ", "=== TRANSLATION ")
result = benchmark.bridge(source, raw=body, repaired=repair)
counts = {token: result["spliced"].count(token) for token, _ in protected["parts"]}
print(json.dumps({"healthy_reordering_accepted": True, "repair_fragments": plan["repair_fragments"],
                  "marker_counts_after_splice": counts,
                  "restored": result["repaired_restored"] is not None}, ensure_ascii=False))
assert result["repaired_restored"] is not None, "Production splice duplicates an intact reordered marker"
