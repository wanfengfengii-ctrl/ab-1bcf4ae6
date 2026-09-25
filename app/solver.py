"""排版联合求解器（纯函数，便于测试）。

每块补片恰选一个候选，整体按字典序择优：
1. 使用帆布张数最少；
2. 各已用帆布剩余面积的最大值最小（剩余面积 = 可裁区域面积 - 已裁面积）；
3. 按补片录入顺序展开的候选序号（每块补片内从 1 起）字典序最小。
"""

from itertools import product

REASON_FIBER = "纤维方向不符"
REASON_BOUNDS = "超出可裁区域（含边缘禁裁宽度）"
REASON_NOT_CHOSEN = "符合约束，但未被最优方案选中"


def cuttable_area(cloth):
    """可裁区域面积：四边各扣除边缘禁裁宽度。"""
    w = cloth["width"] - 2 * cloth["margin"]
    h = cloth["height"] - 2 * cloth["margin"]
    return max(w, 0) * max(h, 0)


def effective_fiber(cloth, rotation):
    """裁片在布上的实际纤维方向：0=经向沿宽，1=经向沿高。旋转 90° 使方向互换。"""
    return cloth["grain"] ^ (1 if rotation == 90 else 0)


def candidate_problems(cloth, cand, patch):
    """单条候选的拒绝原因列表（空列表表示个体兼容）。"""
    problems = []
    if effective_fiber(cloth, cand["rotation"]) != patch["fiber"]:
        problems.append(REASON_FIBER)
    m = cloth["margin"]
    if (cand["x"] < m or cand["y"] < m
            or cand["x"] + cand["w"] > cloth["width"] - m
            or cand["y"] + cand["h"] > cloth["height"] - m):
        problems.append(REASON_BOUNDS)
    return problems


def rects_overlap(a, b):
    """正面积重叠（仅边缘相接不算重叠）。"""
    return (a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"]
            and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"])


def solve(cloths, patches, candidates):
    """联合排版。cloths/patches 按录入顺序给出；candidates 按录入顺序给出。"""
    cloth_by_id = {c["id"]: c for c in cloths}

    # 每块补片的候选（录入顺序，序号从 1 起）及个体兼容性
    per_patch = []          # [(patch, [(index, cand), ...]), ...]
    problems_by_cand = {}   # cand_id -> [原因, ...]
    for patch in patches:
        pcs = []
        idx = 0
        for cand in candidates:
            if cand["patch_id"] != patch["id"]:
                continue
            idx += 1
            pcs.append((idx, cand))
            problems_by_cand[cand["id"]] = candidate_problems(
                cloth_by_id[cand["cloth_id"]], cand, patch)
        per_patch.append((patch, pcs))

    compat = [[(idx, cand) for idx, cand in pcs if not problems_by_cand[cand["id"]]]
              for _, pcs in per_patch]

    # 无解情形一：按录入顺序，首块不存在任何可兼容候选的补片
    for pos, ((patch, pcs), ok_list) in enumerate(zip(per_patch, compat), start=1):
        if not ok_list:
            return {
                "status": "no_solution",
                "reason_code": "no_compatible_candidate",
                "patch_id": patch["id"],
                "patch_index": pos,
                "patch_name": patch["name"],
                "message": f"补片#{pos}「{patch['name']}」不存在任何可兼容候选",
                "candidate_reasons": [
                    {"candidate_id": cand["id"], "index": idx, "cloth_id": cand["cloth_id"],
                     "reasons": problems_by_cand[cand["id"]]}
                    for idx, cand in pcs
                ],
            }

    # 枚举所有组合（最多 4^5=1024 种），检查同布正面积重叠，按目标字典序取最优
    best = None
    best_key = None
    for combo in product(*compat):
        by_cloth = {}
        for _, cand in combo:
            by_cloth.setdefault(cand["cloth_id"], []).append(cand)
        conflict = False
        for pieces in by_cloth.values():
            for i in range(len(pieces)):
                for j in range(i + 1, len(pieces)):
                    if rects_overlap(pieces[i], pieces[j]):
                        conflict = True
                        break
                if conflict:
                    break
            if conflict:
                break
        if conflict:
            continue
        remainings = [
            cuttable_area(cloth_by_id[cid]) - sum(p["w"] * p["h"] for p in pieces)
            for cid, pieces in by_cloth.items()
        ]
        key = (len(by_cloth), max(remainings), tuple(idx for idx, _ in combo))
        if best_key is None or key < best_key:
            best_key, best = key, combo

    if best is None:
        # 无解情形二：每条候选个体兼容，但所有组合均存在正面积重叠
        flat = [(pos, patch, idx, cand)
                for pos, ((patch, _), ok_list) in enumerate(zip(per_patch, compat), start=1)
                for idx, cand in ok_list]
        conflicts = []
        for i in range(len(flat)):
            for j in range(i + 1, len(flat)):
                pa_pos, pa, ia, ca = flat[i]
                pb_pos, pb, ib, cb = flat[j]
                if ca["cloth_id"] == cb["cloth_id"] and rects_overlap(ca, cb):
                    conflicts.append({
                        "patch_a_index": pa_pos, "patch_a_name": pa["name"],
                        "candidate_a_index": ia,
                        "patch_b_index": pb_pos, "patch_b_name": pb["name"],
                        "candidate_b_index": ib,
                        "cloth_id": ca["cloth_id"],
                    })
        return {
            "status": "no_solution",
            "reason_code": "all_combinations_conflict",
            "message": "所有候选组合均存在正面积重叠，无法联合排版",
            "conflicts": conflicts[:100],
        }

    # 组装最优方案
    decisions = []
    adopted = {}  # cand_id -> (patch_pos, patch, index, cand)
    for pos, ((patch, _), (idx, cand)) in enumerate(zip(per_patch, best), start=1):
        adopted[cand["id"]] = (pos, patch, idx, cand)
        decisions.append({
            "patch_index": pos, "patch_id": patch["id"], "patch_name": patch["name"],
            "candidate_index": idx, "candidate_id": cand["id"],
            "cloth_id": cand["cloth_id"],
            "x": cand["x"], "y": cand["y"], "w": cand["w"], "h": cand["h"],
            "rotation": cand["rotation"],
        })

    cloths_summary = []
    for cloth in cloths:
        pieces = [d for d in decisions if d["cloth_id"] == cloth["id"]]
        used_area = sum(p["w"] * p["h"] for p in pieces)
        ghosts = []  # 个体兼容但未采用的候选（示意用虚线）
        for pos, (patch, pcs) in enumerate(per_patch, start=1):
            for idx, cand in pcs:
                if (cand["cloth_id"] == cloth["id"] and cand["id"] not in adopted
                        and not problems_by_cand[cand["id"]]):
                    ghosts.append({
                        "patch_index": pos, "patch_name": patch["name"],
                        "candidate_index": idx,
                        "x": cand["x"], "y": cand["y"], "w": cand["w"], "h": cand["h"],
                    })
        cloths_summary.append({
            "cloth_id": cloth["id"], "name": cloth["name"],
            "width": cloth["width"], "height": cloth["height"],
            "margin": cloth["margin"], "grain": cloth["grain"],
            "used": bool(pieces), "used_area": used_area,
            "cuttable_area": cuttable_area(cloth),
            "remaining": cuttable_area(cloth) - used_area,
            "pieces": pieces, "ghosts": ghosts,
        })

    exclusions = []
    for pos, (patch, pcs) in enumerate(per_patch, start=1):
        for idx, cand in pcs:
            if cand["id"] in adopted:
                continue
            probs = problems_by_cand[cand["id"]]
            if probs:
                reason = "；".join(probs)
            else:
                hit = next((d for d in decisions
                            if d["cloth_id"] == cand["cloth_id"]
                            and rects_overlap(d, cand)), None)
                if hit:
                    reason = f"与补片#{hit['patch_index']}「{hit['patch_name']}」的采用裁片正面积重叠"
                else:
                    reason = REASON_NOT_CHOSEN
            exclusions.append({
                "patch_index": pos, "patch_id": patch["id"], "patch_name": patch["name"],
                "candidate_index": idx, "candidate_id": cand["id"],
                "cloth_id": cand["cloth_id"],
                "x": cand["x"], "y": cand["y"], "w": cand["w"], "h": cand["h"],
                "rotation": cand["rotation"], "reason": reason,
            })

    return {
        "status": "ok",
        "objective": {
            "cloths_used": best_key[0],
            "max_remaining": best_key[1],
            "sequence": list(best_key[2]),
        },
        "decisions": decisions,
        "exclusions": exclusions,
        "cloths": cloths_summary,
    }
