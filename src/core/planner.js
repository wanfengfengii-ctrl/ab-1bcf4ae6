/**
 * 联合排版求解器。
 *
 * 规则（题面）：
 *  - 每块补片恰采用一个候选；
 *  - 候选只有在以下条件全部满足时才可采用（compatible）：
 *      1) 纤维方向相符；
 *      2) 完整落在帆布“可裁区域”内（扣除四边等宽的边缘禁裁带）；
 *      3) 不与同一张帆布上其他已采用裁片发生正面积重叠（边贴边允许）。
 *
 * 目标（严格按顺序比较，取字典序最优）：
 *  1) 使用帆布张数最少；
 *  2) 在张数相同的前提下，各已用帆布剩余面积的最大值最小
 *     （即尽量把占用摊匀，避免一张被吃空、其余几乎不动）；
 *  3) 再相同则按补片录入顺序，候选序号（1 起）字典序最小。
 *
 * 无解时报告：按补片录入顺序，第一块“连一个可兼容候选都没有”的补片；
 * 若每块都有兼容候选但彼此冲突导致无法同时落位，则给出正面积冲突清单。
 */

import { rectsOverlap, intersectionArea } from './validation.js';

/** 候选经过旋转后的实际裁切矩形尺寸（cw90 = 在布面上顺时针转 90°）。 */
export function placedSize(patch, candidate) {
  if (candidate.rotation === 'cw90') {
    return { width: patch.height, height: patch.width };
  }
  return { width: patch.width, height: patch.height };
}

/**
 * 纤维方向是否相符。
 * 约定补片 width 沿纬向(x)、height 沿经向(y)；旋转 90° 后两向纤维对调。
 * canvas.grain 表示其经线（沿 y）方向，裁片沿 y 的纤维须与之相同。
 */
export function grainMatches(patch, candidate, canvas) {
  const alongY = candidate.rotation === 'cw90' ? flipGrain(patch.grain) : patch.grain;
  return alongY === canvas.grain;
}

function flipGrain(g) {
  return g === 'warp' ? 'weft' : 'warp';
}

/** 可裁区域（扣四边等宽禁裁带）：{ x, y, width, height } */
export function cuttableArea(canvas) {
  const m = canvas.margin;
  return { x: m, y: m, width: canvas.width - 2 * m, height: canvas.height - 2 * m };
}

function rectInside(rect, area) {
  return rect.x >= area.x &&
    rect.y >= area.y &&
    rect.x + rect.width <= area.x + area.width &&
    rect.y + rect.height <= area.y + area.height;
}

function grainLabel(g) {
  return g === 'warp' ? '经' : '纬';
}

/** 评估单个候选的静态可采用性（方向、边界、毛坯尺寸）。 */
export function evaluateCandidate(patch, candidate, canvas) {
  const reasons = [];
  const size = placedSize(patch, candidate);
  const rect = { x: candidate.x, y: candidate.y, width: size.width, height: size.height };

  if (!grainMatches(patch, candidate, canvas)) {
    reasons.push(
      `纤维方向不符：补片为${grainLabel(patch.grain)}纱，帆布经线为${grainLabel(canvas.grain)}纱` +
      `${candidate.rotation === 'cw90' ? '，旋转 90° 后走向仍不匹配' : ''}。`,
    );
  }

  const area = cuttableArea(canvas);
  if (!rectInside(rect, area)) {
    reasons.push(
      `越出可裁区域：裁切矩形 (${rect.x},${rect.y})–(${rect.x + rect.width},${rect.y + rect.height}) ` +
      `未完整落在可裁区 (${area.x},${area.y})–(${area.x + area.width},${area.y + area.height}) 内。`,
    );
  }

  if (candidate.width !== patch.width || candidate.height !== patch.height) {
    reasons.push(
      `候选尺寸 ${candidate.width}×${candidate.height} 与补片毛坯 ${patch.width}×${patch.height} 不一致` +
      `（如需横竖向调换请使用 cw90 旋转）。`,
    );
  }

  return { compatible: reasons.length === 0, reasons, rect, area: rect.width * rect.height };
}

function compareObjective(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];         // 使用帆布张数最少
  if (a[1] !== b[1]) return a[1] - b[1];         // 最大剩余面积最小
  for (let i = 0; i < a[2].length; i += 1) {     // 候选序号字典序
    if (a[2][i] !== b[2][i]) return a[2][i] - b[2][i];
  }
  return 0;
}

/**
 * 回溯求最优。forced 可强制某补片采用某候选（用于“假如选它会怎样”分析）。
 * @returns {{key: number[], tuple: number[], used: Map}|null} 无解返回 null
 */
function solve(patches, candidateEvals, canvasById, forced = new Map()) {
  for (const [pi, ci] of forced) {
    if (!candidateEvals[pi][ci].compatible) return null;
  }

  let best = null;
  const chosen = new Array(patches.length).fill(-1);

  function consider() {
    const used = new Map();
    chosen.forEach((ci, pi) => {
      const ev = candidateEvals[pi][ci];
      const slot = used.get(ev.canvasId) || { usedArea: 0 };
      slot.usedArea += ev.area;
      used.set(ev.canvasId, slot);
    });
    let maxRemaining = 0;
    for (const [cid, slot] of used) {
      const c = canvasById.get(cid);
      const remaining = c.width * c.height - slot.usedArea;
      if (remaining > maxRemaining) maxRemaining = remaining;
    }
    const tuple = chosen.slice();
    const key = [used.size, maxRemaining, tuple];
    if (best === null || compareObjective(key, best.key) < 0) {
      best = { key, tuple, used };
    }
  }

  function canPlace(pi, ci) {
    const ev = candidateEvals[pi][ci];
    for (let k = 0; k < pi; k += 1) {
      if (chosen[k] < 0) continue;
      const other = candidateEvals[k][chosen[k]];
      if (other.canvasId === ev.canvasId && rectsOverlap(ev.rect, other.rect)) return false;
    }
    return true;
  }

  function search(pi) {
    if (pi === patches.length) {
      consider();
      return;
    }
    if (forced.has(pi)) {
      const ci = forced.get(pi);
      if (canPlace(pi, ci)) {
        chosen[pi] = ci;
        search(pi + 1);
        chosen[pi] = -1;
      }
      return;
    }
    for (let ci = 0; ci < candidateEvals[pi].length; ci += 1) {
      if (!candidateEvals[pi][ci].compatible) continue;
      if (canPlace(pi, ci)) {
        chosen[pi] = ci;
        search(pi + 1);
        chosen[pi] = -1;
      }
    }
  }

  search(0);
  return best;
}

/**
 * 主入口：对一份草稿求联合最优排版，并给每个候选标注采用/排除理由。
 */
export function planLayout(draft) {
  const { canvases, patches } = draft;
  const canvasById = new Map(canvases.map((c) => [c.id, c]));

  // 1) 逐候选静态评估。
  const candidateEvals = patches.map((patch, pi) =>
    (patch.candidates || []).map((cand, ci) => {
      const canvas = canvasById.get(cand.canvasId);
      if (!canvas) {
        return {
          compatible: false,
          reasons: ['所属帆布不存在。'],
          rect: null,
          area: 0,
          canvasId: cand.canvasId,
          patchIndex: pi,
          candidateIndex: ci,
          rotation: cand.rotation,
        };
      }
      const ev = evaluateCandidate(patch, cand, canvas);
      return { ...ev, canvasId: cand.canvasId, patchIndex: pi, candidateIndex: ci, rotation: cand.rotation };
    }),
  );

  // 2) 首块“没有任何兼容候选”的补片（按录入顺序）。
  const firstImpossible = candidateEvals.findIndex((evs) => !evs.some((e) => e.compatible));

  if (firstImpossible >= 0) {
    return {
      feasible: false,
      candidateEvals,
      alternatives: patches.map((p, pi) =>
        candidateEvals[pi].map((ev) => ({
          kind: ev.compatible ? 'usable' : 'incompatible',
          reasons: ev.reasons,
        }))),
      infeasible: { firstPatchIndex: firstImpossible, conflicts: [] },
    };
  }

  // 3) 联合求解。
  const best = solve(patches, candidateEvals, canvasById);

  if (best === null) {
    return {
      feasible: false,
      candidateEvals,
      alternatives: patches.map((p) => p.candidates.map(() => ({ kind: 'usable' }))),
      infeasible: { firstPatchIndex: null, conflicts: listConflicts(patches, candidateEvals) },
    };
  }

  const tuple = best.tuple;
  const alternatives = explainAlternatives(patches, candidateEvals, canvasById, tuple, best.key);
  const usage = buildUsage(canvases, patches, tuple, candidateEvals, best.used);

  return {
    feasible: true,
    assignment: tuple,
    candidateEvals,
    alternatives,
    usage,
    objective: {
      canvasCount: best.key[0],
      maxRemaining: best.key[1],
      tuple: tuple.map((i) => i + 1),
    },
  };
}

/** 为每个未采用候选生成排除理由。规模极小（≤20 次强制求解）。 */
function explainAlternatives(patches, candidateEvals, canvasById, tuple, bestKey) {
  const t = (arr) => `[${arr.map((i) => i + 1).join(',')}]`;

  return patches.map((patch, pi) =>
    candidateEvals[pi].map((ev, ci) => {
      if (ci === tuple[pi]) return { kind: 'chosen' };
      if (!ev.compatible) return { kind: 'incompatible', reasons: ev.reasons };

      // 与最优方案中哪些采用裁片正面积重叠（直观参考）。
      const clashes = [];
      tuple.forEach((bj, pj) => {
        if (pj === pi) return;
        const other = candidateEvals[pj][bj];
        if (other.canvasId === ev.canvasId) {
          const area = intersectionArea(ev.rect, other.rect);
          if (area > 0) {
            clashes.push({ patchIndex: pj, candidateIndex: bj, overlapArea: area });
          }
        }
      });

      const forced = new Map([[pi, ci]]);
      const alt = solve(patches, candidateEvals, canvasById, forced);

      if (alt === null) {
        const clashText = clashes.length
          ? `它与已采用的${clashes.map((c) =>
            `「${patches[c.patchIndex].name}」候选 ${c.candidateIndex + 1}（重叠 ${c.overlapArea}）`).join('、')}正面积重叠，`
          : '';
        return {
          kind: 'blocks',
          clashes,
          detail: `${clashText}若强制采用此候选，其余补片无论怎样改选都无法同时落位，联合排版无解。`,
        };
      }

      const cmp = compareObjective(alt.key, bestKey);
      if (cmp === 0) {
        return {
          kind: 'equivalent',
          detail: '存在同级方案，但按补片录入顺序比较候选序号，当前采用方案字典序更靠前。',
          alternativeTuple: alt.key[2].map((i) => i + 1),
        };
      }

      const diffs = [];
      if (alt.key[0] > bestKey[0]) {
        diffs.push(`需使用 ${alt.key[0]} 张帆布（最优仅 ${bestKey[0]} 张）`);
      } else if (alt.key[1] > bestKey[1]) {
        diffs.push(`各已用帆布剩余面积最大值由 ${bestKey[1]} 增大为 ${alt.key[1]}，占用更不均衡`);
      } else {
        diffs.push(`候选序号元组 ${t(alt.key[2])} 字典序劣于最优 ${t(bestKey[2])}`);
      }
      return {
        kind: 'dominated',
        clashes,
        detail: `组合可行但目标更差：${diffs.join('；')}。`,
        alternativeTuple: alt.key[2].map((i) => i + 1),
      };
    }),
  );
}

/** 列出同一张帆布上、分属不同补片且均兼容、但正面积重叠的候选对。 */
function listConflicts(patches, candidateEvals) {
  const conflicts = [];
  for (let i = 0; i < patches.length; i += 1) {
    for (let j = i + 1; j < patches.length; j += 1) {
      candidateEvals[i].forEach((a, ai) => {
        if (!a.compatible) return;
        candidateEvals[j].forEach((b, bi) => {
          if (!b.compatible || a.canvasId !== b.canvasId) return;
          const area = intersectionArea(a.rect, b.rect);
          if (area > 0) {
            conflicts.push({
              patchAIndex: i,
              candidateAIndex: ai,
              patchBIndex: j,
              candidateBIndex: bi,
              canvasId: a.canvasId,
              overlapArea: area,
            });
          }
        });
      });
    }
  }
  return conflicts;
}

function buildUsage(canvases, patches, tuple, candidateEvals, used) {
  return canvases.map((c) => {
    const slot = used.get(c.id);
    const cut = cuttableArea(c);
    const placed = [];
    tuple.forEach((ci, pi) => {
      const ev = candidateEvals[pi][ci];
      if (ev.canvasId !== c.id) return;
      placed.push({
        patchIndex: pi,
        patchName: patches[pi].name,
        candidateIndex: ci,
        rect: ev.rect,
        area: ev.area,
        rotation: ev.rotation,
      });
    });
    const totalArea = c.width * c.height;
    const usedArea = slot ? slot.usedArea : 0;
    return {
      canvasId: c.id,
      canvasName: c.name,
      width: c.width,
      height: c.height,
      grain: c.grain,
      margin: c.margin,
      cuttable: cut,
      used: usedArea,
      remaining: totalArea - usedArea,
      totalArea,
      inUse: placed.length > 0,
      placed,
    };
  });
}
