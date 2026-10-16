# SCHEMA_PROVENANCE — 副本来源与哈希对账

> `factory-impl/schemas/` 是 **`factory-v1.2/schemas/` 的逐字节副本**，目的是让
> 实现体可以独立运行、独立验证，而不必从 CWD 猜测规范包位置。
>
> **规范真源永远是 `factory-v1.2/schemas/`（以及更上游的 `Source/**`）。**
> 若两者出现任何差异，**副本是 bug**，不是规范变更。

## 对账方法

```sh
cd /Users/milin/2026/软件开发/Saas_foundation_template
for f in factory-impl/schemas/*.schema.json; do
  b=$(basename "$f")
  cmp -s "$f" "factory-v1.2/schemas/$b" && echo "IDENTICAL $b" || echo "DIFFERS $b"
done
```

## 2026-10-16 对账结果

**15/15 个 schema 逐字节一致（`cmp` 全部 IDENTICAL）。**

| schema | sha256 (factory-impl 与 factory-v1.2 相同) |
|---|---|
| acceptance-report.schema.json | `98638e8f496d14bf2ce151a81fee6482802f1b335500bb8dbad5b5436c32a753` |
| artifact-freeze.schema.json | `1a5b2593c61cdd7439d4942cb69cda68981c76bfdba94b7f782fa2a413609d31` |
| batch-plan.schema.json | `13dc87f5b34e65b66d06b48d357efbeecfb1c26b9d662cfdabf19a314f46b836` |
| change-impact-record.schema.json | `71392fdfbc28cfbe8937638bd9649adf4bafe856a7c4a1c96f82a9bf7424f774` |
| deployment-eligibility-decision.schema.json | `1ef24be9577d0a706be6c4e689868d443b33d27a3c4d52a3e1d84fa4966bfae7` |
| evidence.schema.json | `127b05c41b21a2f5d333fb4d4eb49cc6a69cf90e53b683b87c69e8db2ee90a70` |
| file-manifest.schema.json | `c37f8ef5e9b239c34dc2d2b1f774ab465b15662e5b42b73f48bf452dfe1b1308` |
| gate-profile.schema.json | `a911cbf5e0bee65873914e068514277c36995f6a9428042123a9f1325527e53f` |
| production-catalog.schema.json | `13d05059f84d4d6677642a18fcba9fb1d8d56fd3afe72c75d3862c88ae816c53` |
| production-job.schema.json | `2e70c0668b18d18b6fdcfcecbb45e28636fc31315b2730b8df929866f780b3f0` |
| resource-manifest.schema.json | `6957cae0e4be184647405aa1e00e6c780905a77233665b4b53bd64a6aa22beff` |
| resource-state.schema.json | `62fcbbbf2445be93f0565d60aa16a2101181f3bcc4b2a2b08d88a381ed97c58a` |
| scope-definition.schema.json | `fe1eaaaca3026ed6a48ba41460f57b80d06344acc05f5b6e5a41dc0ecc53fe27` |
| scoped-attestation.schema.json | `3402ee13fc0b902483d013484addb1d651a14b27a4d0cefe4a317cb98e703d1c` |
| state-transition.schema.json | `d3d6cf84b7834e426924e1be96501d27036963705c242df5769c772a8caba66f` |

## 实现期没有改动 schema（重要）

本轮门禁修复（R-G / R-X / R-B / R-C / R-D / R-R）**没有修改任何 schema**：

- **R-G 的 job/attempt 绑定**写在 **workspace 工件**
  （`workspace/jobs/<jobId>/artifacts/artifact-freeze.json`），
  而不写进 registry 的 `ArtifactFreeze`。registry 记录仍严格符合
  `artifact-freeze.schema.json`（`additionalProperties: false`）。
- **R-X 的联签**作为独立的 journal 事件 `cosignatures` 记录，
  不塞进 `state-transition` 记录，避免触碰 `additionalProperties: false`。
- pause/block 的"记录来源阶段"从 **append-only journal** 推导，无需新字段。

> 诚实边界：schema 通过（`schema: check` / `catalog-validate`）**只证明对象形状**，
> 不证明构建、许可、签名或安全结果，**更不是商业认证**。
