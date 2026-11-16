#!/usr/bin/env python3
"""Read the govulncheck JSON stream: OSV inventory is not a finding and exit zero is not proof of no findings."""
import json
from pathlib import Path
import sys

failed = False
for filename in sys.argv[1:]:
    text = Path(filename).read_text()
    decoder = json.JSONDecoder()
    position = 0
    records = []
    while position < len(text):
        if text[position].isspace():
            position += 1
            continue
        record, position = decoder.raw_decode(text, position)
        records.append(record)
    configs = [record["config"] for record in records if "config" in record]
    findings = [record["finding"] for record in records if "finding" in record]
    if len(configs) != 1 or configs[0].get("scanner_name") != "govulncheck":
        raise SystemExit(f"{filename}: missing scanner configuration")
    config = configs[0]
    print(f"{Path(filename).name}: {config.get('scanner_version')}, {config.get('go_version')}, DB {config.get('db_last_modified')}, {len(findings)} finding records")
    for finding in findings:
        trace = finding.get("trace", [])
        symbol = any(frame.get("function") for frame in trace)
        print(f"  {finding['osv']}: {'symbol' if symbol else 'package/module'} trace, fixed {finding.get('fixed_version', 'unknown')}")
    failed |= bool(findings)
if failed:
    raise SystemExit(1)
