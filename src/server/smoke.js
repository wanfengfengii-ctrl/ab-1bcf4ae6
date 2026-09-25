/**
 * 候选冲突业务冒烟：不经 HTTP，直接以默认草稿走一遍领域管线，
 * 断言联合求解识别出“局部省料会令其他补片无处可裁”的情形。
 *
 * @returns {{passed: boolean, checks: Array<{name:string, ok:boolean, detail:string}>}}
 */
import { planLayout } from '../core/planner.js';
import { validateDraft } from '../core/validation.js';
import { defaultDraft } from './defaultDraft.js';

export function runSmoke() {
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, detail: detail || '' });

  const v = validateDraft(defaultDraft);
  record('默认草稿通过录入校验（2–3 帆布 / 3–5 补片 / 每补片 2–4 候选）', v.ok,
    v.ok ? '' : v.errors.join('；'));

  const plan = planLayout(defaultDraft);

  record('默认草稿存在可行联合方案', plan.feasible,
    plan.feasible ? `使用帆布 ${plan.objective.canvasCount} 张` : '误判为无解');

  if (plan.feasible) {
    // 贪心（局部最省料：大肘补 P1 取甲布角落的候选 1）必然与方肘补 P2 的
    // 全部甲布可兼容候选正面积重叠——冒烟必须确认该冲突被识别。
    const p1C0 = plan.candidateEvals[0][0];
    const p2Compat = plan.candidateEvals[1].filter((e) => e.compatible);
    const blocksAll = p2Compat.every((e) => e.canvasId !== p1C0.canvasId ||
      p1C0.rect.x < e.rect.x + e.rect.width && e.rect.x < p1C0.rect.x + p1C0.rect.width &&
      p1C0.rect.y < e.rect.y + e.rect.height && e.rect.y < p1C0.rect.y + p1C0.rect.height);
    record('局部省料选择（P1 候选 1 落甲布）会令 P2 在甲布无处可裁', blocksAll,
      blocksAll ? 'P2 的全部甲布兼容候选均与之正面积重叠' : '冲突几何构造失效');

    // 联合最优必须把 P1 放到第 2 个候选（乙布、旋转 90°）。
    const p1Choice = plan.objective.tuple[0];
    record('联合求解避开局部陷阱：P1 改用候选 2（乙布 cw90）', p1Choice === 2,
      `实际 P1 采用候选 ${p1Choice}`);

    record('每块补片恰采用一个候选', plan.assignment.length === defaultDraft.patches.length &&
      plan.assignment.every((i) => Number.isInteger(i) && i >= 0),
      `采用序列（1 起）：${plan.objective.tuple.join(', ')}`);

    record('使用帆布张数达到下界 2', plan.objective.canvasCount === 2,
      `实际 ${plan.objective.canvasCount} 张`);
  }

  // 反例：把大肘补限制为只能选甲布角落 → P2 无任何可落位候选。
  const trapped = structuredClone(defaultDraft);
  trapped.patches[0].candidates = [trapped.patches[0].candidates[0]];
  // 每块补片要求 2–4 候选，这里改为直接调用求解器以构造“无兼容候选”的极端情形：
  // 再把 P2 所有候选挪入与 P1 冲突的位置。
  trapped.patches[1].candidates = trapped.patches[1].candidates
    .filter((c) => c.canvasId === 'C1')
    .map((c) => ({ ...c, x: 14, y: 14 }));
  const bad = planLayout(trapped);
  record('全部候选互斥时判定无解', !bad.feasible, bad.feasible ? '误判为有解' : '已报告无解');

  // 首块不存在任何可兼容候选的补片：P2 的候选全部越出可裁区。
  const noFit = structuredClone(defaultDraft);
  noFit.patches[1].candidates = noFit.patches[1].candidates.map((c) => ({ ...c, x: 1000, y: 1000 }));
  const noFitPlan = planLayout(noFit);
  record('无解时按录入顺序指出首块无兼容候选的补片（P2）',
    !noFitPlan.feasible && noFitPlan.infeasible.firstPatchIndex === 1,
    noFitPlan.feasible ? '误判为有解' :
      `首块序号（0 起）=${noFitPlan.infeasible.firstPatchIndex}`);

  return { passed: checks.every((c) => c.ok), checks };
}
