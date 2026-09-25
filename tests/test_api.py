import pytest

from app.server import app


@pytest.fixture()
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        c.post("/api/reset")
        yield c


def seed_basic(client):
    """2 张布 + 3 块补片 × 2 个候选；最优解为全部落在小布上，序号序列 [2,2,2]。"""
    client.post("/api/cloths", json={"name": "A", "width": 100, "height": 100, "grain": 0, "margin": 0})
    client.post("/api/cloths", json={"name": "B", "width": 50, "height": 50, "grain": 0, "margin": 0})
    for i in range(3):
        client.post("/api/patches", json={"name": f"P{i+1}", "fiber": 0})
    st = client.get("/api/state").get_json()
    a, b = st["cloths"][0]["id"], st["cloths"][1]["id"]
    pids = [p["id"] for p in st["patches"]]
    for pid, x in zip(pids, (0, 20, 40)):
        client.post(f"/api/patches/{pid}/candidates",
                    json={"cloth_id": a, "x": x, "y": 0, "w": 10, "h": 10, "rotation": 0})
        client.post(f"/api/patches/{pid}/candidates",
                    json={"cloth_id": b, "x": x, "y": 0, "w": 10, "h": 10, "rotation": 0})
    return a, b, pids


def test_health(client):
    assert client.get("/health").get_json()["status"] == "ok"


def test_cloth_validation(client):
    r = client.post("/api/cloths", json={"name": "X", "width": 10, "height": 10, "grain": 0, "margin": 5})
    assert r.status_code == 400  # 禁裁后无可裁区域
    r = client.post("/api/cloths", json={"name": "X", "width": 10, "height": 10, "grain": 2, "margin": 0})
    assert r.status_code == 400  # 经纬方向非法
    for i in range(3):
        assert client.post("/api/cloths", json={"name": f"C{i}", "width": 10, "height": 10,
                                                "grain": 0, "margin": 0}).status_code == 201
    r = client.post("/api/cloths", json={"name": "C3", "width": 10, "height": 10, "grain": 0, "margin": 0})
    assert r.status_code == 400  # 最多 3 张


def test_candidate_validation_and_limit(client):
    client.post("/api/cloths", json={"name": "A", "width": 100, "height": 100, "grain": 0, "margin": 0})
    client.post("/api/patches", json={"name": "P", "fiber": 0})
    st = client.get("/api/state").get_json()
    cid, pid = st["cloths"][0]["id"], st["patches"][0]["id"]
    r = client.post(f"/api/patches/{pid}/candidates",
                    json={"cloth_id": cid, "x": 0, "y": 0, "w": 10, "h": 10, "rotation": 45})
    assert r.status_code == 400  # 旋转仅支持 0/90
    for i in range(4):
        assert client.post(f"/api/patches/{pid}/candidates",
                           json={"cloth_id": cid, "x": i * 20, "y": 0, "w": 10, "h": 10,
                                 "rotation": 0}).status_code == 201
    r = client.post(f"/api/patches/{pid}/candidates",
                    json={"cloth_id": cid, "x": 0, "y": 50, "w": 10, "h": 10, "rotation": 0})
    assert r.status_code == 400  # 每块补片最多 4 个候选


def test_layout_preconditions(client):
    assert client.post("/api/layout").status_code == 400
    client.post("/api/cloths", json={"name": "A", "width": 100, "height": 100, "grain": 0, "margin": 0})
    client.post("/api/cloths", json={"name": "B", "width": 100, "height": 100, "grain": 0, "margin": 0})
    client.post("/api/patches", json={"name": "P1", "fiber": 0})
    assert client.post("/api/layout").status_code == 400  # 补片不足 / 候选不足


def test_layout_happy_path(client):
    seed_basic(client)
    res = client.post("/api/layout").get_json()
    assert res["status"] == "ok"
    assert res["objective"]["cloths_used"] == 1
    assert res["objective"]["max_remaining"] == 2200
    assert res["objective"]["sequence"] == [2, 2, 2]
    assert len(res["decisions"]) == 3
    assert len(res["exclusions"]) == 3
    st = client.get("/api/state").get_json()
    assert st["layout"] is not None and not st["layout_stale"]


def test_draft_mutation_invalidates_layout(client):
    a, b, pids = seed_basic(client)
    assert client.post("/api/layout").get_json()["status"] == "ok"
    client.post("/api/cloths", json={"name": "C", "width": 80, "height": 80, "grain": 0, "margin": 0})
    st = client.get("/api/state").get_json()
    assert st["layout"] is None
    assert st["layout_stale"] is True
    # 重新排版后结论恢复为当前修订
    assert client.post("/api/layout").status_code == 200
    st = client.get("/api/state").get_json()
    assert st["layout"] is not None and not st["layout_stale"]


def test_delete_cloth_removes_its_candidates(client):
    a, b, pids = seed_basic(client)
    client.delete(f"/api/cloths/{a}")
    st = client.get("/api/state").get_json()
    assert all(c["cloth_id"] == b for c in st["candidates"])


def test_delete_patch_removes_its_candidates(client):
    a, b, pids = seed_basic(client)
    client.delete(f"/api/patches/{pids[0]}")
    st = client.get("/api/state").get_json()
    assert all(c["patch_id"] != pids[0] for c in st["candidates"])
    assert len(st["patches"]) == 2
