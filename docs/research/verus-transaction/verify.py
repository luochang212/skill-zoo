#!/usr/bin/env python3
"""Verify the isolated model and require semantic mutations to fail."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verus", type=Path, required=True)
    args = parser.parse_args()
    verifier = args.verus.resolve(strict=True)
    source_path = Path(__file__).with_name("recovery.rs")
    source = source_path.read_text()
    forbidden = r"\b(assume|admit|assume_specification)\s*[({]|\bexternal(_body|_fn_specification)?\b|\baxiom\b"
    if re.search(forbidden, source):
        raise SystemExit("Model contains an unchecked proof escape; review before running")

    mutations = {
        "wrong_commit_branch": (
            "    if committed {\n        apply_prefix(disk, after, limit);\n    } else {\n        apply_prefix(disk, before, limit);\n    }",
            "    if committed {\n        apply_prefix(disk, before, limit);\n    } else {\n        apply_prefix(disk, after, limit);\n    }",
        ),
        "delete_journal_early": ("    limit < before.len()\n", "    false\n"),
        "omit_snapshot_write": ("        disk.set(i, target[i]);", "        let _ = target[i];"),
        "omit_retry": (
            "        recover_prefix(disk, before, after, committed, before.len())\n",
            "        false\n",
        ),
    }
    cases = {"baseline": source}
    for name, (old, new) in mutations.items():
        if source.count(old) != 1:
            raise SystemExit(f"Mutation anchor drifted: {name}")
        cases[name] = source.replace(old, new, 1)

    # Temporary copies keep negative examples and verifier outputs out of the project.
    with tempfile.TemporaryDirectory(prefix="skill-zoo-verus-") as temporary:
        version = subprocess.run(
            [str(verifier), "--version"], cwd=temporary, capture_output=True, text=True,
            check=True, timeout=30,
        ).stdout.strip()
        results = []
        for name, text in cases.items():
            path = Path(temporary, f"{name}.rs")
            path.write_text(text)
            started = time.perf_counter()
            run = subprocess.run(
                [str(verifier), str(path), "--rlimit", "10", "--triggers-mode", "silent"],
                cwd=temporary, capture_output=True, text=True, timeout=60,
            )
            output = run.stdout + run.stderr
            summary = re.search(r"verification results:: (\d+) verified, (\d+) errors", output)
            if not summary:
                raise SystemExit(f"No verification result for {name}:\n{output}")
            verified, errors = map(int, summary.groups())
            diagnostic = re.search(r"^error: (.+)$", output, re.MULTILINE)
            if name == "baseline":
                accepted = run.returncode == 0 and errors == 0 and verified > 0
            else:
                accepted = (
                    run.returncode != 0 and errors > 0 and diagnostic is not None
                    and diagnostic.group(1) in (
                        "postcondition not satisfied", "invariant not satisfied at end of loop body",
                    )
                )
            results.append({
                "case": name, "expected": "pass" if name == "baseline" else "verification failure",
                "accepted": accepted, "exit_code": run.returncode,
                "verified": verified, "errors": errors,
                "diagnostic": diagnostic.group(1) if diagnostic else None,
                "seconds": round(time.perf_counter() - started, 3),
            })
            if not accepted:
                raise SystemExit(f"Unexpected result for {name}:\n{output}")

    print(json.dumps({
        "source_sha256": hashlib.sha256(source.encode()).hexdigest(),
        "verus": version, "unchecked_proof_escapes": False, "cases": results,
    }, indent=2))


if __name__ == "__main__":
    main()
