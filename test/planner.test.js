import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, rectsOverlap, intersectionArea } from '../src/core/validation.js';
import { planLayout, placedSize, cuttableArea, grainMatches } from '../src/core/planner.js';

const canvas = (over = {}) => ({ id: 'C1', name: '甲', width: 100, height: 80, grain: 'warp', margin: 5, ...over });
const cand = (over = {}) => ({ canvasId: 'C1', x: 10, y: 10, width: 20, height: 10, rotation: 'none', ...over });
const patch = (over = {}) => ({
  id: 'P', name: '补', width: 20, height: 10, grain: 'warp',
  candidates: [cand(), cand({ x: 30 })], ...over,
});

const draft = (over = {}) => ({
  canvases: [canvas(), canvas({ id: 'C2', name: '乙', grain: 'weft' })],
  patches: [
    patch(),
    patch({ id: 'P2', name: '补二', candidates: [cand({ y: 30 }), cand({ x: 30, y: 30 })] }),
    patch({ id: 'P3', name: '补三', candidates: [cand({ y: 55 }), cand({ x: 30, y: 55 })] }),
  ],
  ...over,
});

test('校验：合法草稿通过', () => {
  assert.equal(validateDraft(draft()).ok, true);
});

test('校验：帆布/补片/候选数量越界均被拒绝', () => {
  const fewCanvases = draft({ canvases: [canvas()] });
  assert.equal(validateDraft(fewCanvases).ok, false);
  const twoPatches = draft({ patches: [patch(), patch({ id: 'P2' })] });
  assert.equal(validateDraft(twoPatches).ok, false);
  const oneCand = draft({ patches: [patch({ candidates: [cand()] }), patch({ id: 'P2' }), patch({ id: 'P3' })] });
  const r = validateDraft(oneCand);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /候选数量/);
});

test('校验：非正整数尺寸、非法方向、未知帆布均报错', () => {
  const d = draft({
    patches: [
      patch({ width: 0, candidates: [cand({ canvasId: 'XX' }), cand({ rotation: 'bad' })] }),
      patch({ id: 'P2', grain: 'diagonal' }),
      patch({ id: 'P3', candidates: [cand({ x: -1 }), cand({ y: 1.5 })] }),
    ],
  });
  const r = validateDraft(d);
  assert.equal(r.ok, false);
  const msg = r.errors.join();
  assert.match(msg, /宽度/);
  assert.match(msg, /所属帆布/);
  assert.match(msg, /旋转/);
  assert.match(msg, /纤维方向/);
});

test('校验：禁裁边吃掉整块布时报错', () => {
  const r = validateDraft(draft({ canvases: [canvas({ margin: 60 }), canvas({ id: 'C2', grain: 'weft' })] }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /禁裁边/);
});

test('矩形：边贴边不算正面积重叠', () => {
  assert.equal(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 }), false);
  assert.equal(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 5, height: 5 }), true);
  assert.equal(intersectionArea({ x: 0, y: 0, width: 4, height: 4 }, { x: 2, y: 1, width: 4, height: 4 }), 6);
});

test('旋转 90° 交换实际裁切宽高', () => {
  const p = patch({ width: 20, height: 10 });
  assert.deepEqual(placedSize(p, { rotation: 'none' }), { width: 20, height: 10 });
  assert.deepEqual(placedSize(p, { rotation: 'cw90' }), { width: 10, height: 20 });
});

test('可裁区域扣除四边等宽禁裁带', () => {
  assert.deepEqual(cuttableArea(canvas()), { x: 5, y: 5, width: 90, height: 70 });
});

test('纤维方向：同向不旋转相符，旋转后需布方向相应', () => {
  const cW = canvas({ grain: 'warp' });
  const cF = canvas({ id: 'C2', grain: 'weft' });
  const pW = patch({ grain: 'warp' });
  assert.equal(grainMatches(pW, { rotation: 'none' }, cW), true);
  assert.equal(grainMatches(pW, { rotation: 'cw90' }, cW), false);
  assert.equal(grainMatches(pW, { rotation: 'cw90' }, cF), true);
});

test('候选越出可裁区域 → 不兼容并给出理由', () => {
  const d = {
    canvases: [canvas(), canvas({ id: 'C2', grain: 'weft' })],
    patches: [
      patch({ candidates: [cand({ x: 90, y: 70 }), cand({ x: 9, y: 9 })] }),
      patch({ id: 'P2', candidates: [cand({ y: 30 }), cand({ x: 30, y: 30 })] }),
      patch({ id: 'P3', candidates: [cand({ y: 55 }), cand({ x: 30, y: 55 })] }),
    ],
  };
  const plan = planLayout(d);
  assert.equal(plan.feasible, true);
  assert.equal(plan.candidateEvals[0][0].compatible, false);
  assert.match(plan.candidateEvals[0][0].reasons.join(), /越出可裁区域/);
  // (9,9,20×10) 完整位于可裁区 (5,5,90×70) 内 → 兼容。
  assert.equal(plan.candidateEvals[0][1].compatible, true);
});

test('联合求解：避开局部省料陷阱（跨布冲突）', () => {
  // C1 warp，P2 只能放 C1；P1 的 C1 候选盖住 P2 全部 C1 候选，
  // 局部贪心选 C1 会让 P2 无处可裁，最优必须把 P1 放 C2（旋转）。
  const d = {
    canvases: [
      { id: 'C1', name: '甲', width: 120, height: 100, grain: 'warp', margin: 8 },
      { id: 'C2', name: '乙', width: 120, height: 100, grain: 'weft', margin: 8 },
    ],
    patches: [
      { id: 'P1', name: '大', width: 40, height: 60, grain: 'warp', candidates: [
        { canvasId: 'C1', x: 10, y: 10, width: 40, height: 60, rotation: 'none' },
        { canvasId: 'C2', x: 10, y: 10, width: 40, height: 60, rotation: 'cw90' },
      ] },
      { id: 'P2', name: '方', width: 30, height: 30, grain: 'warp', candidates: [
        { canvasId: 'C1', x: 12, y: 12, width: 30, height: 30, rotation: 'none' },
        { canvasId: 'C1', x: 15, y: 42, width: 30, height: 30, rotation: 'none' },
      ] },
      { id: 'P3', name: '小', width: 20, height: 20, grain: 'weft', candidates: [
        { canvasId: 'C2', x: 70, y: 20, width: 20, height: 20, rotation: 'none' },
        { canvasId: 'C2', x: 70, y: 60, width: 20, height: 20, rotation: 'none' },
      ] },
    ],
  };
  const plan = planLayout(d);
  assert.equal(plan.feasible, true);
  assert.deepEqual(plan.objective.tuple, [2, 1, 1]);
  assert.equal(plan.objective.canvasCount, 2);
});

test('目标比较：张数优先，其次最大剩余面积最小，再候选字典序', () => {
  // P1 有 C1/C2 两个互不相干的候选；P2 仅 C2。
  // 方案 (P1=C1,P2=C2) 用 2 张布；方案 (P1=C2,P2=C2) 用 1 张 → 后者胜。
  const d = {
    canvases: [
      { id: 'C1', name: '甲', width: 100, height: 100, grain: 'warp', margin: 0 },
      { id: 'C2', name: '乙', width: 100, height: 100, grain: 'warp', margin: 0 },
    ],
    patches: [
      { id: 'P1', name: '一', width: 20, height: 20, grain: 'warp', candidates: [
        { canvasId: 'C1', x: 0, y: 0, width: 20, height: 20, rotation: 'none' },
        { canvasId: 'C2', x: 0, y: 0, width: 20, height: 20, rotation: 'none' },
      ] },
      { id: 'P2', name: '二', width: 20, height: 20, grain: 'warp', candidates: [
        { canvasId: 'C2', x: 30, y: 0, width: 20, height: 20, rotation: 'none' },
        { canvasId: 'C2', x: 60, y: 0, width: 20, height: 20, rotation: 'none' },
      ] },
      { id: 'P3', name: '三', width: 20, height: 20, grain: 'warp', candidates: [
        { canvasId: 'C1', x: 30, y: 0, width: 20, height: 20, rotation: 'none' },
        { canvasId: 'C1', x: 60, y: 0, width: 20, height: 20, rotation: 'none' },
      ] },
    ],
  };
  // P3 只能在 C1：若 P1 选 C2、P3 选 C1 则用 2 张；
  // 若 P1 选 C1，与 P3 在同一布仍可容纳（不重叠），也是 2 张。
  // 两者张数相同：
  //   方案A P1=C2,P2候选1,P3候选1：C2 用 400、C1 用 400 → 最大剩余 9600
  //   方案B P1=C1,P2候选1,P3候选1：C1 用 800 → C1 剩 9200；C2 用 400 → 剩 9600
  // 最大剩余都是 9600？C1 总 10000：方案B max(9200,9600)=9600；方案A 用布 C1=400(剩9600),C2=400(剩9600) → 9600 平。
  // 平局 → 候选序号字典序：方案B 元组 (1,1,1) < 方案A (2,1,1)，方案B 胜。
  const plan = planLayout(d);
  assert.equal(plan.feasible, true);
  assert.deepEqual(plan.objective.tuple, [1, 1, 1]);

  // 把 P3 的两个 C1 候选都移到与 P1-C1 候选重叠 → 方案B 不可行，只剩方案A。
  const d2 = structuredClone(d);
  d2.patches[2].candidates = d2.patches[2].candidates.map((c) => ({ ...c, x: 5, y: 5 }));
  const plan2 = planLayout(d2);
  assert.equal(plan2.feasible, true);
  assert.deepEqual(plan2.objective.tuple, [2, 1, 1]);
});

test('无解：指出按录入顺序首块无任何兼容候选的补片', () => {
  const d = draft({
    patches: [
      patch(),
      patch({ id: 'P2', candidates: [cand({ x: 500 }), cand({ y: 500 })] }),
      patch({ id: 'P3' }),
    ],
  });
  const plan = planLayout(d);
  assert.equal(plan.feasible, false);
  assert.equal(plan.infeasible.firstPatchIndex, 1);
});

test('无解：每块都有兼容候选但同布全部互斥 → firstPatchIndex 为 null，给出冲突清单', () => {
  const d = {
    canvases: [{ id: 'C1', name: '甲', width: 100, height: 100, grain: 'warp', margin: 0 }],
    patches: [
      { id: 'P1', name: '一', width: 60, height: 60, grain: 'warp', candidates: [
        { canvasId: 'C1', x: 0, y: 0, width: 60, height: 60, rotation: 'none' },
        { canvasId: 'C1', x: 40, y: 40, width: 60, height: 60, rotation: 'none' },
      ] },
      { id: 'P2', name: '二', width: 60, height: 60, grain: 'warp', candidates: [
        { canvasId: 'C1', x: 10, y: 10, width: 60, height: 60, rotation: 'none' },
        { canvasId: 'C1', x: 30, y: 0, width: 60, height: 60, rotation: 'none' },
      ] },
      { id: 'P3', name: '三', width: 10, height: 10, grain: 'warp', candidates: [
        { canvasId: 'C1', x: 0, y: 70, width: 10, height: 10, rotation: 'none' },
        { canvasId: 'C1', x: 80, y: 80, width: 10, height: 10, rotation: 'none' },
      ] },
    ],
  };
  // 需要 2–3 张帆布才能通过校验，但求解器本身不做数量校验；直接调用求解器。
  const plan = planLayout(d);
  assert.equal(plan.feasible, false);
  assert.equal(plan.infeasible.firstPatchIndex, null);
  assert.ok(plan.infeasible.conflicts.length > 0);
});

test('usage 明细：未使用的帆布 inUse=false、remaining=总面积', () => {
  const plan = planLayout(draft());
  assert.equal(plan.feasible, true);
  const used = plan.usage.filter((u) => u.inUse);
  const idle = plan.usage.filter((u) => !u.inUse);
  assert.ok(used.length >= 1);
  for (const u of idle) assert.equal(u.remaining, u.totalArea);
  for (const u of used) {
    const sum = u.placed.reduce((s, p) => s + p.area, 0);
    assert.equal(sum, u.used);
  }
});
