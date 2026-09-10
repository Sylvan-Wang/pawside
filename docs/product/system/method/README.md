# Pawside Method Canonical Pipeline

Pawside 运行时只读取已发布的数据库规则，不直接读取 Excel、PRD、视频或转写。

当前离线发布链：

    source checksum
    → Canonical Workbook
    → importer validation
    → semantic diff
    → draft/validated release manifest
    → SQL contracts
    → explicit activation

Pawside_三分化_Canonical_Method_Workbook_v1.2.xlsx 是 v1.1 加 P0 Resolution Patch v0.1 后的 Canonical 副本。原始下载文件不覆盖。

V1 Runtime 与 Strict Method Certification 是两个独立发布门。Internal/Beta 可以在 Runtime gate 通过、Strict gate 仍 blocked 时继续；production activation 必须等待 Strict gate 通过。
