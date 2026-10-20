# Holdout notes

Points deliberately not tested because the specification is ambiguous or not externally observable:

- Chunk size, overlap and retrieval top-k (architecture.md T3/T4) are stated as defaults and may vary; implementations may document deviations, so exact chunk counts / retrieval counts are not asserted.
- Auto-retry backoff exact timings (200 ms, doubling) are not asserted to avoid timing-dependent flakiness; only attempt counts are checked.
- Whether soft-deleted documents appear in `/export` is not asserted; the export contract lists `documents` but soft-delete visibility is ambiguous.
- Real-mode rejection of missing configuration is exercised for a representative subset (MODEL_PROVIDER and MODEL_API_KEY); the official suite covers every variable.
- Exact audit-event actor/target fields beyond type and ordering are not asserted where not fully specified.
- Whether `jobId` is null on chat usage records is not asserted; only `reportId` is checked.
- UI rendering details beyond the documented `data-testid` anchors are not tested.