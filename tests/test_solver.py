from app import solver


def cloth(cid=1, width=100, height=100, grain=0, margin=0, name="A"):
    return {"id": cid, "name": name, "width": width, "height": height,
            "grain": grain, "margin": margin}


def patch(pid=1, fiber=0, name="P"):
    return {"id": pid, "name": name, "fiber": fiber}


def cand(cid, patch_id, cloth_id, x, y, w, h, rotation=0):
    return {"id": cid, "patch_id": patch_id, "cloth_id": cloth_id,
            "x": x, "y": y, "w": w, "h": h, "rotation": rotation}


def test_effective_fiber_rotation_swaps():
    assert solver.effective_fiber(cloth(grain=0), 0) == 0
    assert solver.effective_fiber(cloth(grain=0), 90) == 1
    assert solver.effective_fiber(cloth(grain=1), 0) == 1
    assert solver.effective_fiber(cloth(grain=1), 90) == 0


def test_candidate_problems_fiber_and_bounds():
    c = cloth(width=100, height=100, grain=0, margin=10)
    p = patch(fiber=0)
    # 恰好贴到禁裁边内沿：兼容
    assert solver.candidate_problems(c, cand(1, 1, 1, 10, 10, 80, 80), p) == []
    # 纤维方向不符
    assert solver.REASON_FIBER in solver.candidate_problems(c, cand(2, 1, 1, 20, 20, 10, 10, 90), p)
    # 侵入禁裁边 / 越界
    assert solver.REASON_BOUNDS in solver.candidate_problems(c, cand(3, 1, 1, 9, 10, 10, 10), p)
    assert solver.REASON_BOUNDS in solver.candidate_problems(c, cand(4, 1, 1, 80, 80, 11, 10), p)


def test_rects_overlap_positive_area_only():
    a = {"x": 0, "y": 0, "w": 10, "h": 10}
    assert not solver.rects_overlap(a, {"x": 10, "y": 0, "w": 10, "h": 10})  # 边缘相接
    assert not solver.rects_overlap(a, {"x": 0, "y": 10, "w": 10, "h": 10})
    assert solver.rects_overlap(a, {"x": 9, "y": 0, "w": 10, "h": 10})       # 正面积重叠


def test_fewest_cloths_then_min_max_remaining():
    """同样 1 张布即可排完时，选剩余面积最大值更小的方案（把整张大布省下来）。"""
    cloths = [cloth(1, 100, 100, name="大布"), cloth(2, 50, 50, name="小布")]
    patches = [patch(10), patch(11), patch(12)]
    candidates = [
        cand(1, 10, 1, 0, 0, 10, 10), cand(2, 10, 2, 0, 0, 10, 10),
        cand(3, 11, 1, 20, 0, 10, 10), cand(4, 11, 2, 20, 0, 10, 10),
        cand(5, 12, 1, 40, 0, 10, 10), cand(6, 12, 2, 40, 0, 10, 10),
    ]
    res = solver.solve(cloths, patches, candidates)
    assert res["status"] == "ok"
    assert res["objective"]["cloths_used"] == 1
    assert res["objective"]["max_remaining"] == 2500 - 300
    assert res["objective"]["sequence"] == [2, 2, 2]


def test_max_remaining_uses_candidate_area():
    """同一批布内，剩余面积按候选实际宽×高结算，取最大值更小的方案。"""
    cloths = [cloth(1, 100, 100)]
    patches = [patch(10), patch(11), patch(12)]
    candidates = [
        cand(1, 10, 1, 0, 0, 10, 10),
        cand(2, 11, 1, 50, 0, 10, 10),   # 面积 100
        cand(3, 11, 1, 0, 50, 20, 10),   # 面积 200 → 剩余更小，应被选中
        cand(4, 12, 1, 90, 90, 10, 10),
    ]
    res = solver.solve(cloths, patches, candidates)
    assert res["status"] == "ok"
    assert res["objective"]["sequence"] == [1, 2, 1]
    assert res["objective"]["max_remaining"] == 10000 - 400


def test_candidate_index_tiebreak():
    """目标前两项相同时，按补片录入顺序展开的候选序号字典序最小。"""
    cloths = [cloth(1, 100, 100)]
    patches = [patch(10), patch(11), patch(12)]
    candidates = [
        cand(1, 10, 1, 0, 0, 10, 10),
        cand(2, 10, 1, 0, 0, 10, 10),   # 与候选 1 完全等价
        cand(3, 11, 1, 50, 50, 10, 10),
        cand(4, 12, 1, 90, 90, 10, 10),
    ]
    res = solver.solve(cloths, patches, candidates)
    assert res["status"] == "ok"
    assert res["objective"]["sequence"] == [1, 1, 1]


def test_no_solution_reports_first_patch_without_compatible_candidate():
    cloths = [cloth(1, 100, 100, grain=0), cloth(2, 100, 100, grain=1)]
    patches = [patch(10, fiber=0), patch(11, fiber=0), patch(12, fiber=1)]
    candidates = [
        cand(1, 10, 1, 0, 0, 10, 10), cand(2, 10, 1, 20, 0, 10, 10),      # P1 可行
        cand(3, 11, 1, 0, 0, 10, 10, 90), cand(4, 11, 2, 0, 0, 10, 10),   # P2 纤维均不符
        cand(5, 12, 1, 0, 0, 10, 10), cand(6, 12, 1, 200, 0, 10, 10, 90), # P3 纤维/越界
    ]
    res = solver.solve(cloths, patches, candidates)
    assert res["status"] == "no_solution"
    assert res["reason_code"] == "no_compatible_candidate"
    assert res["patch_index"] == 2
    assert len(res["candidate_reasons"]) == 2


def test_no_solution_all_combinations_conflict():
    cloths = [cloth(1, 100, 100, grain=0), cloth(2, 100, 100, grain=1)]
    patches = [patch(10), patch(11), patch(12)]
    candidates = [
        cand(1, 10, 1, 0, 0, 40, 40), cand(2, 10, 1, 5, 5, 40, 40),
        cand(3, 11, 1, 10, 10, 40, 40), cand(4, 11, 1, 15, 15, 40, 40),
        cand(5, 12, 1, 20, 20, 40, 40), cand(6, 12, 1, 25, 25, 40, 40),
    ]
    res = solver.solve(cloths, patches, candidates)
    assert res["status"] == "no_solution"
    assert res["reason_code"] == "all_combinations_conflict"
    assert res["conflicts"]


def test_exclusion_reasons():
    cloths = [cloth(1, 100, 100, grain=0), cloth(2, 100, 100, grain=1)]
    patches = [patch(10), patch(11), patch(12)]
    candidates = [
        cand(1, 10, 1, 0, 0, 10, 10),    # 采用
        cand(2, 10, 1, 5, 5, 10, 10),    # 与采用裁片重叠
        cand(3, 10, 1, 50, 50, 10, 10),  # 兼容但未被选中
        cand(4, 11, 1, 20, 0, 10, 10),   # 采用
        cand(5, 11, 2, 0, 0, 10, 10),    # 纤维方向不符
        cand(6, 12, 1, 0, 20, 10, 10),   # 采用
        cand(7, 12, 1, 95, 95, 10, 10),  # 超出可裁区域
    ]
    res = solver.solve(cloths, patches, candidates)
    assert res["status"] == "ok"
    assert res["objective"]["sequence"] == [1, 1, 1]
    reasons = {e["candidate_id"]: e["reason"] for e in res["exclusions"]}
    assert "正面积重叠" in reasons[2]
    assert "未被最优方案选中" in reasons[3]
    assert "纤维方向不符" in reasons[5]
    assert "超出可裁区域" in reasons[7]
