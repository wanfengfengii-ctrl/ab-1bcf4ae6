"""Flask API 与静态页服务。内存草稿 + 修订号：任何修改都会使旧排版结论失效。"""

import threading

from flask import Flask, jsonify, request, send_from_directory

from . import solver

app = Flask(__name__)
lock = threading.Lock()

LIMITS = {"cloths": 3, "patches": 5, "candidates_per_patch": 4}
MINIMUMS = {"cloths": 2, "patches": 3, "candidates_per_patch": 2}

state = {
    "revision": 0,
    "next_id": 1,
    "cloths": [],
    "patches": [],
    "candidates": [],
    "layout": None,  # {"revision": int, "result": dict}
}


def new_id():
    state["next_id"] += 1
    return state["next_id"] - 1


def touch():
    state["revision"] += 1


def find(items, item_id):
    return next((x for x in items if x["id"] == item_id), None)


def err(msg, code=400):
    return jsonify({"error": msg}), code


def body():
    return request.get_json(silent=True) or {}


def as_int(data, field, lo=None, hi=None):
    v = data.get(field)
    if isinstance(v, bool) or not isinstance(v, int):
        try:
            v = int(str(v).strip())
        except (TypeError, ValueError):
            raise ValueError(f"字段 {field} 必须为整数")
    if lo is not None and v < lo:
        raise ValueError(f"字段 {field} 不能小于 {lo}")
    if hi is not None and v > hi:
        raise ValueError(f"字段 {field} 不能大于 {hi}")
    return v


def as_name(data):
    name = str(data.get("name", "")).strip()
    if not name:
        raise ValueError("名称不能为空")
    if len(name) > 40:
        raise ValueError("名称过长（不超过 40 字符）")
    return name


def public_state():
    layout = state["layout"]
    fresh = layout is not None and layout["revision"] == state["revision"]
    return {
        "revision": state["revision"],
        "limits": LIMITS,
        "minimums": MINIMUMS,
        "cloths": state["cloths"],
        "patches": state["patches"],
        "candidates": state["candidates"],
        # 草稿一旦修改，旧结论不再作为当前结论下发
        "layout": layout["result"] if fresh else None,
        "layout_stale": layout is not None and not fresh,
    }


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/state")
def get_state():
    with lock:
        return jsonify(public_state())


@app.post("/api/reset")
def reset():
    with lock:
        state.update({"revision": 0, "next_id": 1,
                      "cloths": [], "patches": [], "candidates": [], "layout": None})
        return jsonify(public_state())


@app.post("/api/cloths")
def add_cloth():
    data = body()
    try:
        name = as_name(data)
        width = as_int(data, "width", 1, 10 ** 6)
        height = as_int(data, "height", 1, 10 ** 6)
        grain = as_int(data, "grain", 0, 1)
        margin = as_int(data, "margin", 0, 10 ** 6)
        if width - 2 * margin < 1 or height - 2 * margin < 1:
            raise ValueError("边缘禁裁宽度过大：可裁区域必须为正")
    except ValueError as e:
        return err(str(e))
    with lock:
        if len(state["cloths"]) >= LIMITS["cloths"]:
            return err(f"帆布最多 {LIMITS['cloths']} 张")
        state["cloths"].append({"id": new_id(), "name": name, "width": width,
                                "height": height, "grain": grain, "margin": margin})
        touch()
        return jsonify(public_state()), 201


@app.delete("/api/cloths/<int:cid>")
def del_cloth(cid):
    with lock:
        cloth = find(state["cloths"], cid)
        if not cloth:
            return err("帆布不存在", 404)
        state["cloths"].remove(cloth)
        state["candidates"] = [c for c in state["candidates"] if c["cloth_id"] != cid]
        touch()
        return jsonify(public_state())


@app.post("/api/patches")
def add_patch():
    data = body()
    try:
        name = as_name(data)
        fiber = as_int(data, "fiber", 0, 1)
    except ValueError as e:
        return err(str(e))
    with lock:
        if len(state["patches"]) >= LIMITS["patches"]:
            return err(f"补片最多 {LIMITS['patches']} 块")
        state["patches"].append({"id": new_id(), "name": name, "fiber": fiber})
        touch()
        return jsonify(public_state()), 201


@app.delete("/api/patches/<int:pid>")
def del_patch(pid):
    with lock:
        patch = find(state["patches"], pid)
        if not patch:
            return err("补片不存在", 404)
        state["patches"].remove(patch)
        state["candidates"] = [c for c in state["candidates"] if c["patch_id"] != pid]
        touch()
        return jsonify(public_state())


@app.post("/api/patches/<int:pid>/candidates")
def add_candidate(pid):
    data = body()
    try:
        cloth_id = as_int(data, "cloth_id")
        x = as_int(data, "x", 0, 10 ** 6)
        y = as_int(data, "y", 0, 10 ** 6)
        w = as_int(data, "w", 1, 10 ** 6)
        h = as_int(data, "h", 1, 10 ** 6)
        rotation = as_int(data, "rotation", 0, 90)
        if rotation not in (0, 90):
            raise ValueError("旋转方向仅支持 0° 或 90°")
    except ValueError as e:
        return err(str(e))
    with lock:
        if not find(state["patches"], pid):
            return err("补片不存在", 404)
        if not find(state["cloths"], cloth_id):
            return err("帆布不存在", 404)
        if sum(1 for c in state["candidates"] if c["patch_id"] == pid) >= LIMITS["candidates_per_patch"]:
            return err(f"每块补片最多 {LIMITS['candidates_per_patch']} 个候选")
        state["candidates"].append({"id": new_id(), "patch_id": pid, "cloth_id": cloth_id,
                                    "x": x, "y": y, "w": w, "h": h, "rotation": rotation})
        touch()
        return jsonify(public_state()), 201


@app.delete("/api/candidates/<int:cid>")
def del_candidate(cid):
    with lock:
        cand = find(state["candidates"], cid)
        if not cand:
            return err("候选不存在", 404)
        state["candidates"].remove(cand)
        touch()
        return jsonify(public_state())


@app.post("/api/layout")
def layout():
    with lock:
        problems = []
        if len(state["cloths"]) < MINIMUMS["cloths"]:
            problems.append(f"至少需要 {MINIMUMS['cloths']} 张帆布（当前 {len(state['cloths'])} 张）")
        if len(state["patches"]) < MINIMUMS["patches"]:
            problems.append(f"至少需要 {MINIMUMS['patches']} 块补片（当前 {len(state['patches'])} 块）")
        for i, p in enumerate(state["patches"], 1):
            n = sum(1 for c in state["candidates"] if c["patch_id"] == p["id"])
            if n < MINIMUMS["candidates_per_patch"]:
                problems.append(f"补片#{i}「{p['name']}」至少需要 "
                                f"{MINIMUMS['candidates_per_patch']} 个候选（当前 {n} 个）")
        if problems:
            return err("；".join(problems))
        result = solver.solve(state["cloths"], state["patches"], state["candidates"])
        state["layout"] = {"revision": state["revision"], "result": result}
        return jsonify(result)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
