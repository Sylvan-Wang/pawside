#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Process Chinese food nutrition Excel file and generate cleaned CSV seed files.

Actual Excel structure (6 columns, 1725 data rows):
  col0 = 食物（每100克）
  col1 = 能量（kal）      -> energy_kcal_100g
  col2 = 蛋白质（克）     -> protein_g_100g
  col3 = 糖类（克）       -> carb_g_100g
  col4 = 脂肪（克）       -> fat_g_100g
  col5 = 纤维（克）       -> fiber_g_100g
  sodium_mg_100g = not available in this file -> will be empty
"""

import openpyxl
import csv
import re
import os

# ── Paths ─────────────────────────────────────────────────────────────────────
EXCEL_PATH = r"C:\Users\28021\Desktop\各种食物营养成分表.xlsx"
OUT_DIR    = r"C:\Users\28021\Desktop\Pawside\supabase\seeds"
os.makedirs(OUT_DIR, exist_ok=True)

# ── Column index mapping ───────────────────────────────────────────────────────
COL_FOOD     = 0
COL_ENERGY   = 1   # 能量 kcal
COL_PROTEIN  = 2   # 蛋白质 g
COL_CARB     = 3   # 糖类 g
COL_FAT      = 4   # 脂肪 g
COL_FIBER    = 5   # 纤维 g
# sodium: not present — will be empty

# ── Merge rules ───────────────────────────────────────────────────────────────
MERGE_MAP = {
    "\u9e21\u8109\u8089": "\u9e21\u80f8\u8089",   # 鸡脯肉 → 鸡胸肉
    "\u9e21\u5927\u80f8": "\u9e21\u80f8\u8089",   # 鸡大胸 → 鸡胸肉
    "\u9e21\u5c0f\u80f8": "\u9e21\u80f8\u8089",   # 鸡小胸 → 鸡胸肉
    "\u6c34\u716e\u86cb": "\u9e21\u86cb\uff08\u716e\uff09",  # 水煮蛋 → 鸡蛋（煮）
    "\u767d\u716e\u86cb": "\u9e21\u86cb\uff08\u716e\uff09",  # 白煮蛋 → 鸡蛋（煮）
    "\u767d\u7c73\u996d": "\u7c73\u996d",           # 白米饭 → 米饭
    "\u84b8\u7c73\u996d": "\u7c73\u996d",           # 蒸米饭 → 米饭
    "\u65e0\u7cd6\u8c46\u5976": "\u8c46\u6d46\uff08\u65e0\u7cd6\uff09",  # 无糖豆奶 → 豆浆（无糖）
    "\u539f\u5473\u8c46\u6d46": "\u8c46\u6d46",    # 原味豆浆 → 豆浆
}

# ── Category rules (ordered — first match wins) ───────────────────────────────
CATEGORY_RULES = [
    ("\u8089\u79bd\u6c34\u4ea7",   # 肉禽水产
     "\u732a|\u725b|\u7f8a|\u9e21|\u9e2d|\u9e45|\u9c7c|\u867e|\u87f9|\u8c1d|\u87ba|\u86e4|\u5899\u9c7c|\u9c7f\u9c7c|\u9c8d|\u6d77\u53c2|\u9aa8"),
    ("\u86cb\u7c7b",               # 蛋类
     "\u86cb"),
    ("\u4e73\u5236\u54c1",         # 乳制品
     "\u5976|\u4e73|\u9178\u5976|\u5976\u7c89|\u5976\u916a|\u9ec4\u6cb9|\u829d\u58eb"),
    ("\u8c46\u7c7b\u53ca\u5236\u54c1",  # 豆类及制品
     "\u8c46\u8150|\u8c46\u6d46|\u8c46\u5e72|\u8c46\u76ae|\u7eb3\u8c46|\u8c46\u82bd|\u9ec4\u8c46|\u7eff\u8c46|\u7ea2\u8c46|\u9ed1\u8c46|\u6bdb\u8c46|\u6241\u8c46|\u8c4c\u8c46|\u82b8\u8c46"),
    ("\u4e3b\u98df\u53ca\u8c37\u7269",  # 主食及谷物
     "\u7c73|\u9762|\u993d\u5934|\u5305\u5b50|\u997a\u5b50|\u9762\u6761|\u9762\u5305|\u996e|\u7ca5|\u7cd5|\u7c89|\u9928\u9968|\u9965|\u996d"),
    ("\u852c\u83dc\u7c7b",         # 蔬菜类
     "\u83dc|\u83e0|\u8289|\u97ed|\u8471|\u849c|\u59dc|\u8fa3\u6912|\u756a\u8304|\u9ec4\u74dc|\u8304|\u5357\u74dc|\u51ac\u74dc|\u82e6\u74dc|\u841d\u535c|\u85d5|\u82bd|\u7b0b|\u8611|\u6728\u8033|\u6d77\u5e26|\u7d2b\u83dc|\u82b1\u6930|\u897f\u5170|\u767d\u83dc|\u9752\u83dc|\u751f\u83dc|\u8392|\u82a6\u7b0b"),
    ("\u6c34\u679c\u7c7b",         # 水果类
     "\u82f9\u679c|\u68a8|\u6a59|\u6a58|\u67da|\u6843|\u674e|\u674f|\u8461\u8404|\u8349\u8393|\u897f\u74dc|\u751c\u74dc|\u8292\u679c|\u83e0\u8428|\u9999\u8549|\u8350\u679d|\u9f99\u773c|\u6930|\u67a3|\u67ff|\u77f3\u69b4|\u730e\u7334\u6843|\u84dd\u8393|\u6a31\u6843|\u5c71\u6a42"),
    ("\u6cb9\u8102\u7c7b",         # 油脂类
     "\u6cb9|\u9ec4\u6cb9|\u732a\u6cb9|\u725b\u6cb9|\u8d77\u915f|\u916f\u6cb9|\u690d\u7269\u6cb9"),
    ("\u96f6\u98df\u751c\u54c1",   # 零食甜品
     "\u7cd6|\u5de7\u514b\u529b|\u7cd6\u679c|\u9972\u5e72|\u86cb\u7cd5|\u66f2\u5947|\u6d3e|\u8587\u7247|\u96f6\u98df|\u8bdd\u6885|\u871c\u9970|\u679c\u8138|\u679c\u51bb|\u51b0\u6de2\u6de2|\u96ea\u7cd5"),
    ("\u996e\u54c1",               # 饮品
     "\u8336|\u548f\u556a\u5561|\u679c\u6c41|\u6c7d\u6c34|\u53ef\u4e50|\u554a\u9152|\u767d\u9152|\u7ea2\u9152|\u9ec4\u9152|\u996e\u6599|\u77ff\u6cc9\u6c34|\u8c46\u5976"),
    ("\u8c03\u5473\u54c1",         # 调味品
     "\u76d0|\u9171|\u918b|\u5473\u7cbe|\u9e21\u7cbe|\u82b1\u6912|\u516b\u89d2|\u6842\u76ae|\u9999\u6599|\u8c03\u6599|\u9171\u6cb9|\u880e\u6cb9|\u756a\u8304\u9171|\u8fa3\u9171"),
    ("\u575a\u679c\u79cd\u5b50",   # 坚果种子
     "\u575a\u679c|\u82b1\u751f|\u6838\u6843|\u8170\u679c|\u674f\u4ec1|\u74dc\u5b50|\u677e\u5b50|\u699b\u5b50|\u677f\u6817|\u82dd\u9ebb"),
]
DEFAULT_CATEGORY = "\u5176\u4ed6"  # 其他

def infer_category(name: str) -> str:
    for cat, pattern in CATEGORY_RULES:
        if re.search(pattern, name):
            return cat
    return DEFAULT_CATEGORY

def clean_name(raw) -> str | None:
    """Strip, normalize brackets/spaces; return None if empty."""
    if raw is None:
        return None
    s = str(raw).strip()
    # normalize full-width parentheses to half-width
    s = s.replace("\uff08", "(").replace("\uff09", ")")
    # normalize full-width space
    s = s.replace("\u3000", " ")
    s = s.strip()
    return s if s else None

def is_corrupted(name: str) -> bool:
    """Detect corrupted rows (stray quotes + catalog codes)."""
    if '"' in name and re.search(r'[A-Z]\d{4,}', name):
        return True
    return False

def to_float_or_none(val):
    if val is None:
        return None
    s = str(val).strip()
    if s in ("", "-", "—", "N/A"):
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None

def fmt_float(v) -> str:
    """Format float for CSV: empty string if None."""
    if v is None:
        return ""
    return str(v)

# ── Aliases (hardcoded) ────────────────────────────────────────────────────────
ALIASES = [
    ("\u9e21\u80f8\u8089", "\u9e21\u8109\u8089"),     # 鸡胸肉, 鸡脯肉
    ("\u9e21\u80f8\u8089", "\u9e21\u5927\u80f8"),     # 鸡胸肉, 鸡大胸
    ("\u9e21\u80f8\u8089", "\u9e21\u5c0f\u80f8"),     # 鸡胸肉, 鸡小胸
    ("\u9e21\u80f8\u8089", "\u9e21\u767d\u8089"),     # 鸡胸肉, 鸡白肉
    ("\u9e21\u86cb", "\u9e21\u86cb\uff08\u751f\uff09"),  # 鸡蛋, 鸡蛋（生）
    ("\u9e21\u86cb", "\u571f\u9e21\u86cb"),           # 鸡蛋, 土鸡蛋
    ("\u9e21\u86cb\uff08\u716e\uff09", "\u6c34\u716e\u86cb"),   # 鸡蛋（煮）, 水煮蛋
    ("\u9e21\u86cb\uff08\u716e\uff09", "\u767d\u716e\u86cb"),   # 鸡蛋（煮）, 白煮蛋
    ("\u9e21\u86cb\uff08\u716e\uff09", "\u719f\u9e21\u86cb"),   # 鸡蛋（煮）, 熟鸡蛋
    ("\u7c73\u996d", "\u767d\u7c73\u996d"),           # 米饭, 白米饭
    ("\u7c73\u996d", "\u84b8\u7c73\u996d"),           # 米饭, 蒸米饭
    ("\u7c73\u996d", "\u767d\u996d"),                 # 米饭, 白饭
    ("\u8c46\u6d46", "\u539f\u5473\u8c46\u6d46"),     # 豆浆, 原味豆浆
    ("\u8c46\u6d46\uff08\u65e0\u7cd6\uff09", "\u65e0\u7cd6\u8c46\u5976"),   # 豆浆（无糖）, 无糖豆奶
    ("\u8c46\u6d46\uff08\u65e0\u7cd6\uff09", "\u65e0\u7cd6\u8c46\u6d46"),   # 豆浆（无糖）, 无糖豆浆
    ("\u732a\u8089\uff08\u7626\uff09", "\u91cc\u810a\u8089"),   # 猪肉（瘦）, 里脊肉
    ("\u732a\u8089\uff08\u7626\uff09", "\u732a\u91cc\u810a"),   # 猪肉（瘦）, 猪里脊
    ("\u725b\u8089\uff08\u7626\uff09", "\u91cc\u810a"),         # 牛肉（瘦）, 里脊
    ("\u725b\u8089\uff08\u7626\uff09", "\u725b\u91cc\u810a"),   # 牛肉（瘦）, 牛里脊
    ("\u4e09\u6587\u9c7c", "\u9c91\u9c7c"),           # 三文鱼, 鲑鱼
    ("\u4e09\u6587\u9c7c", "\u5927\u897f\u6d0b\u9c91"),  # 三文鱼, 大西洋鲑
    ("\u82b1\u751f", "\u843d\u82b1\u751f"),           # 花生, 落花生
    ("\u82b1\u751f", "\u82b1\u751f\u7c73"),           # 花生, 花生米
    ("\u71d5\u9ea6", "\u71d5\u9ea6\u7247"),           # 燕麦, 燕麦片
    ("\u71d5\u9ea6", "\u9ea6\u7247"),                 # 燕麦, 麦片
]

# =============================================================================
# MAIN PROCESSING
# =============================================================================

print("Loading Excel...")
wb = openpyxl.load_workbook(EXCEL_PATH, read_only=True, data_only=True)
ws = wb.active
all_rows = list(ws.iter_rows(values_only=True))
wb.close()

total_input = len(all_rows) - 1  # subtract header row
data_rows   = all_rows[1:]       # skip header
print(f"  Input rows (excl. header): {total_input}")

# ── Pass 1: clean names, track removals ──────────────────────────────────────
mapping_records = []
removed_empty   = 0
removed_corrupt = 0

cleaned = []  # list of (original_name, clean_name, row_data)
for row in data_rows:
    raw_name = row[COL_FOOD]
    name = clean_name(raw_name)

    if name is None:
        mapping_records.append((str(raw_name) if raw_name is not None else "", "", "removed"))
        removed_empty += 1
        continue

    if is_corrupted(name):
        mapping_records.append((name, "", "removed"))
        removed_corrupt += 1
        continue

    # Convert numerics
    energy  = to_float_or_none(row[COL_ENERGY])
    protein = to_float_or_none(row[COL_PROTEIN])
    carb    = to_float_or_none(row[COL_CARB])
    fat     = to_float_or_none(row[COL_FAT])
    fiber   = to_float_or_none(row[COL_FIBER])

    cleaned.append({
        "original_name": name,
        "canonical_name": name,   # will be updated by merge logic
        "action": "kept",
        "energy": energy,
        "protein": protein,
        "carb": carb,
        "fat": fat,
        "fiber": fiber,
        "sodium": None,           # not in source
    })

# ── Pass 2: apply merges ──────────────────────────────────────────────────────
merges_applied = []
for item in cleaned:
    orig = item["original_name"]
    if orig in MERGE_MAP:
        tgt = MERGE_MAP[orig]
        item["canonical_name"] = tgt
        item["action"] = "merged"
        merges_applied.append(f"{orig} → {tgt}")

# ── Pass 3: deduplicate ───────────────────────────────────────────────────────
# Priority: "kept" rows before "merged" rows for same canonical_name
action_order = {"kept": 0, "merged": 1}
cleaned.sort(key=lambda x: (x["canonical_name"], action_order[x["action"]]))

seen          = {}       # canonical_name -> item (first/best occurrence)
removed_dups  = 0

for item in cleaned:
    cname = item["canonical_name"]
    if cname not in seen:
        seen[cname] = item
        mapping_records.append((item["original_name"], cname, item["action"]))
    else:
        # duplicate — record in mapping but don't add to output
        removed_dups += 1
        mapping_records.append((item["original_name"], cname, item["action"]))

final_items = list(seen.values())

# ── Pass 4: assign food_id and infer category ─────────────────────────────────
for i, item in enumerate(final_items, start=1):
    item["food_id"]  = i
    item["category"] = infer_category(item["canonical_name"])

# =============================================================================
# WRITE OUTPUT FILES
# =============================================================================

def write_csv(path, header, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)
    print(f"Wrote: {path}  ({len(rows)} rows)")

# 1. foods_clean.csv
foods_rows = [(item["food_id"], item["canonical_name"], item["category"])
              for item in final_items]
write_csv(
    os.path.join(OUT_DIR, "foods_clean.csv"),
    ["food_id", "canonical_name", "category"],
    foods_rows
)

# 2. food_nutrition_clean.csv
nutrition_rows = [
    (
        item["food_id"],
        fmt_float(item["energy"]),
        fmt_float(item["protein"]),
        fmt_float(item["fat"]),
        fmt_float(item["carb"]),
        fmt_float(item["fiber"]),
        fmt_float(item["sodium"]),  # always empty
    )
    for item in final_items
]
write_csv(
    os.path.join(OUT_DIR, "food_nutrition_clean.csv"),
    ["food_id", "energy_kcal_100g", "protein_g_100g", "fat_g_100g",
     "carb_g_100g", "fiber_g_100g", "sodium_mg_100g"],
    nutrition_rows
)

# 3. cleaning_mapping.csv
write_csv(
    os.path.join(OUT_DIR, "cleaning_mapping.csv"),
    ["original_name", "canonical_name", "action"],
    mapping_records
)

# 4. food_aliases_seed.csv
alias_rows = [(a[0], a[1]) for a in ALIASES]
write_csv(
    os.path.join(OUT_DIR, "food_aliases_seed.csv"),
    ["canonical_name", "alias"],
    alias_rows
)

# =============================================================================
# SUMMARY
# =============================================================================
print("\n" + "="*60)
print("SUMMARY")
print("="*60)
print(f"Total rows in input            : {total_input}")
print(f"Total foods after cleaning     : {len(final_items)}")
print(f"Rows removed — empty names     : {removed_empty}")
print(f"Rows removed — corrupted names : {removed_corrupt}")
print(f"Rows removed — duplicates      : {removed_dups}")
print(f"Merges applied                 : {len(merges_applied)}")
for m in merges_applied:
    print(f"  {m}")
print(f"Total aliases generated        : {len(ALIASES)}")
print("="*60)

# Category distribution
from collections import Counter
cat_counts = Counter(item["category"] for item in final_items)
print("\nCategory distribution:")
for cat, cnt in sorted(cat_counts.items(), key=lambda x: -x[1]):
    print(f"  {cat}: {cnt}")

# Sample output
print("\nSample foods_clean rows (first 10):")
for item in final_items[:10]:
    print(f"  {item['food_id']:4d}  {item['canonical_name']:<20}  {item['category']}")
