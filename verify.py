"""一次性校验服务：代码测试 + 构建 + 候选冲突业务冒烟。

依次执行：
1. 构建：全部源码字节码编译；
2. 代码测试：pytest；
3. 业务冒烟：通过 HTTP 驱动 web 服务，覆盖候选冲突无解、首块无兼容候选、
   联合择优目标值、草稿修改后旧结论失效。

全部通过以退出码 0 结束，否则退出码 1。
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

WEB_BASE = os.environ.get("WEB_BASE", "http://web:5000").rstrip("/")
ROOT = os.path.dirname(os.path.abspath(__file__))

results = []


def record(name, ok, detail=""):
    results.append((name, ok))
    line = f"[{'PASS' if ok else 'FAIL'}] {name}"
    if detail:
        line += f" — {detail}"
    print(line, flush=True)


def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)


def step_build():
    r = run([sys.executable, "-m", "compileall", "-q", "app", "tests", "verify.py"])
    record("构建（字节码编译）", r.returncode == 0, (r.stderr or "").strip()[:500])


def step_tests():
    r = run([sys.executable, "-m", "pytest", "-q"])
    tail = (r.stdout.strip().splitlines() or [""])[-1]
    record("代码测试（pytest）", r.returncode == 0, tail)


def http(method, path, payload=None):
    req = urllib.request.Request(
        WEB_BASE + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status, json.loads(resp.read().decode())


def wait_ready():
    for _ in range(60):
        try:
            _, data = http("GET", "/health")
            if data.get("status") == "ok":
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def add_cloth(name, width, height, grain, margin):
    http("POST", "/api/cloths", {"name": name, "width": width, "height": height,
                                 "grain": grain, "margin": margin})
    return next(c["id"] for c in http("GET", "/api/state")[1]["cloths"] if c["name"] == name)


def add_patch(name, fiber):
    http("POST", "/api/patches", {"name": name, "fiber": fiber})
    return next(p["id"] for p in http("GET", "/api/state")[1]["patches"] if p["name"] == name)


def add_cand(pid, cloth_id, x, y, w, h, rotation):
    http("POST", f"/api/patches/{pid}/candidates",
         {"cloth_id": cloth_id, "x": x, "y": y, "w": w, "h": h, "rotation": rotation})


def smoke(name, fn):
    try:
        http("POST", "/api/reset")
        fn()
    except Exception as e:
        record(name, False, repr(e))


def scenario_conflict():
    """所有候选组合均正面积重叠 → 无解并列出冲突。"""
    a = add_cloth("A", 100, 100, 0, 0)
    add_cloth("B", 100, 100, 1, 0)
    p1, p2, p3 = add_patch("P1", 0), add_patch("P2", 0), add_patch("P3", 0)
    add_cand(p1, a, 0, 0, 40, 40, 0)
    add_cand(p1, a, 5, 5, 40, 40, 0)
    add_cand(p2, a, 10, 10, 40, 40, 0)
    add_cand(p2, a, 15, 15, 40, 40, 0)
    add_cand(p3, a, 20, 20, 40, 40, 0)
    add_cand(p3, a, 25, 25, 40, 40, 0)
    _, res = http("POST", "/api/layout")
    ok = (res.get("status") == "no_solution"
          and res.get("reason_code") == "all_combinations_conflict"
          and res.get("conflicts"))
    record("业务冒烟（候选冲突→无解）", bool(ok), res.get("message", ""))


def scenario_no_compatible():
    """首块不存在任何可兼容候选的补片（按录入顺序应为第 3 块）。"""
    a = add_cloth("A", 100, 100, 0, 10)
    b = add_cloth("B", 80, 80, 1, 0)
    p1, p2, p3 = add_patch("P1", 0), add_patch("P2", 1), add_patch("P3", 0)
    add_cand(p1, a, 20, 20, 10, 10, 0)
    add_cand(p1, a, 30, 30, 10, 10, 0)
    add_cand(p2, a, 60, 20, 10, 10, 90)  # 旋转后纤维相符
    add_cand(p2, b, 0, 0, 10, 10, 0)
    add_cand(p3, a, 0, 0, 10, 10, 0)     # 侵入禁裁边
    add_cand(p3, b, 0, 0, 10, 10, 0)     # 纤维方向不符
    _, res = http("POST", "/api/layout")
    ok = (res.get("status") == "no_solution"
          and res.get("reason_code") == "no_compatible_candidate"
          and res.get("patch_index") == 3)
    record("业务冒烟（首块无兼容候选）", bool(ok), res.get("message", ""))


def scenario_optimal_and_stale():
    """联合择优：1 张布即可，选剩余面积最大值更小的方案（小布），序号 [2,2,2]。"""
    a = add_cloth("A", 100, 100, 0, 0)
    b = add_cloth("B", 50, 50, 0, 0)
    p1, p2, p3 = add_patch("P1", 0), add_patch("P2", 0), add_patch("P3", 0)
    for pid, x in ((p1, 0), (p2, 20), (p3, 40)):
        add_cand(pid, a, x, 0, 10, 10, 0)
        add_cand(pid, b, x, 0, 10, 10, 0)
    _, res = http("POST", "/api/layout")
    obj = res.get("objective", {})
    ok = (res.get("status") == "ok" and obj.get("cloths_used") == 1
          and obj.get("max_remaining") == 2200 and obj.get("sequence") == [2, 2, 2])
    record("业务冒烟（联合择优目标值）", bool(ok), json.dumps(obj, ensure_ascii=False))
    # 修改草稿 → 旧结论必须失效
    http("POST", f"/api/patches/{p1}/candidates",
         {"cloth_id": a, "x": 60, "y": 0, "w": 10, "h": 10, "rotation": 0})
    st = http("GET", "/api/state")[1]
    record("业务冒烟（草稿修改→旧结论失效）",
           st.get("layout") is None and st.get("layout_stale") is True)


def step_smoke():
    if not wait_ready():
        record("业务冒烟（web 健康检查）", False, f"{WEB_BASE} 60 秒内未就绪")
        return
    record("业务冒烟（web 健康检查）", True, WEB_BASE)
    smoke("业务冒烟（候选冲突→无解）", scenario_conflict)
    smoke("业务冒烟（首块无兼容候选）", scenario_no_compatible)
    smoke("业务冒烟（联合择优目标值）", scenario_optimal_and_stale)


def main():
    print(f"== verify 开始（web: {WEB_BASE}）==", flush=True)
    step_build()
    step_tests()
    step_smoke()
    failed = [name for name, ok in results if not ok]
    print(f"== verify 结束：{len(results) - len(failed)}/{len(results)} 项通过 ==", flush=True)
    if failed:
        print("未通过：" + "、".join(failed), flush=True)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
