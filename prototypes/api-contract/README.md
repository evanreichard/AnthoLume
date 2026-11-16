# API contract proof

Bounded M2 proof, not a production API or migration. Six OpenAPI 3.0.3 operations exercise strict Gin generation, signed cookie authentication, validation/problems, nullable library DTOs, synthetic EPUB transfer, and durable activity/progress receipts.

From the repository root:

```sh
bash prototypes/api-contract/scripts/verify.sh
bash prototypes/api-contract/scripts/audit.sh
```

Requires Go 1.26.11+, Node 22.23.4, npm, Python 3, and initial module/registry access. The nested module requires the patched Go minimum; automatic toolchain selection may download it. All listeners belong to tests. The nested module replaces `reichard.io/antholume` with the read-only repository root for actual SQLC document/progress queries; root dependencies are unchanged.

- `openapi.yaml` is authoritative; `bash scripts/generate.sh` regenerates Go and TypeScript. Never edit generated files.
- `scripts/check-drift.sh` generates twice into scratch, checks determinism, and compares both checked-in outputs without changing them.
- `scripts/fault-check.py` checks deduplication, CAS, validation, signed zero, KO effects/rollback, activity receipt kind, ZIP integrity and schema drift using scratch copies only.
- `scripts/audit.sh` verifies modules and scans the prototype/root API graph with pinned govulncheck plus npm audit. It inspects JSON finding records, not just scanner exit status.
- `fixture.sql` models core production columns plus proof-only receipt/revision tables. It does not test production migrations.
- Upload returns `validated_only`; it neither creates a document nor publishes files. Download returns the same synthetic fixture for any live fixture document.

Pins, contracts, evidence, tradeoffs, and promotion gates: [M2 report](../../docs/evaluation/m2-api-contract.md).
