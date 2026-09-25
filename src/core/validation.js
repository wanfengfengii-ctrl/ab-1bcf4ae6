/**
 * 领域常量与纯数据校验。
 *
 * 录入规模约束（题面）：
 *   帆布        2–3 张
 *   补片        3–5 块
 *   每块补片候选 2–4 个（经批准的整数坐标裁切候选）
 *
 * 坐标、宽高均为正整数（左上坐标原点 (0,0)，x 向右为纬、y 向下为经）。
 */

export const LIMITS = Object.freeze({
  canvasMin: 2,
  canvasMax: 3,
  patchMin: 3,
  patchMax: 5,
  candidateMin: 2,
  candidateMax: 4,
});

export const GRAINS = Object.freeze(['warp', 'weft']); // 经（经线方向 warp）、纬（纬线方向 weft）
export const ROTATIONS = Object.freeze(['none', 'cw90']);

const isInt = (v) => Number.isInteger(v);

/**
 * 校验整份草稿。返回 { ok, errors }，errors 为面向用户的中文说明数组。
 * @param {{canvases: any[], patches: any[]}} draft
 */
export function validateDraft(draft) {
  const errors = [];
  const ctx = (kind, i) => `${kind === 'canvas' ? `第 ${i + 1} 张帆布` : `第 ${i + 1} 块补片`}`;

  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return { ok: false, errors: ['草稿格式不正确：需要包含 canvases 与 patches 的对象。'] };
  }
  const canvases = draft.canvases;
  const patches = draft.patches;

  if (!Array.isArray(canvases) || !Array.isArray(patches)) {
    return { ok: false, errors: ['草稿格式不正确：canvases / patches 必须为数组。'] };
  }

  if (canvases.length < LIMITS.canvasMin || canvases.length > LIMITS.canvasMax) {
    errors.push(`帆布张数须为 ${LIMITS.canvasMin}–${LIMITS.canvasMax} 张，当前为 ${canvases.length} 张。`);
  }
  if (patches.length < LIMITS.patchMin || patches.length > LIMITS.patchMax) {
    errors.push(`补片数量须为 ${LIMITS.patchMin}–${LIMITS.patchMax} 块，当前为 ${patches.length} 块。`);
  }

  const ids = new Set();
  const names = new Set();
  canvases.forEach((c, i) => {
    const where = ctx('canvas', i);
    if (!c || typeof c !== 'object') {
      errors.push(`${where}：数据缺失。`);
      return;
    }
    if (typeof c.id !== 'string' || !c.id.trim()) {
      errors.push(`${where}：缺少编号。`);
    } else if (ids.has(c.id.trim())) {
      errors.push(`${where}：编号“${c.id.trim()}”与其他帆布重复。`);
    } else {
      ids.add(c.id.trim());
    }
    if (typeof c.name !== 'string' || !c.name.trim()) {
      errors.push(`${where}：缺少名称。`);
    } else if (names.has(c.name.trim())) {
      errors.push(`${where}：名称“${c.name.trim()}”与其他帆布重复。`);
    } else {
      names.add(c.name.trim());
    }
    if (!isInt(c.width) || c.width <= 0) errors.push(`${where}：宽度须为正整数（像素）。`);
    if (!isInt(c.height) || c.height <= 0) errors.push(`${where}：高度须为正整数（像素）。`);
    if (!GRAINS.includes(c.grain)) errors.push(`${where}：纤维方向须为 warp（经）或 weft（纬）。`);
    if (!isInt(c.margin) || c.margin < 0) errors.push(`${where}：边缘禁裁宽度须为非负整数。`);
    if (isInt(c.width) && isInt(c.height) && isInt(c.margin) && c.margin * 2 >= Math.min(c.width, c.height)) {
      errors.push(`${where}：禁裁边过宽，内部已无任何可裁区域。`);
    }
  });

  patches.forEach((p, i) => {
    const where = ctx('patch', i);
    if (!p || typeof p !== 'object') {
      errors.push(`${where}：数据缺失。`);
      return;
    }
    if (typeof p.name !== 'string' || !p.name.trim()) errors.push(`${where}：缺少名称。`);
    if (!isInt(p.width) || p.width <= 0) errors.push(`${where}：宽度须为正整数。`);
    if (!isInt(p.height) || p.height <= 0) errors.push(`${where}：高度须为正整数。`);
    if (!GRAINS.includes(p.grain)) errors.push(`${where}：纤维方向须为 warp（经）或 weft（纬）。`);

    const cands = Array.isArray(p.candidates) ? p.candidates : null;
    if (!cands) {
      errors.push(`${where}：候选缺失。`);
      return;
    }
    if (cands.length < LIMITS.candidateMin || cands.length > LIMITS.candidateMax) {
      errors.push(`${where}：候选数量须为 ${LIMITS.candidateMin}–${LIMITS.candidateMax} 个，当前为 ${cands.length} 个。`);
    }
    cands.forEach((cd, j) => {
      const at = `${where}候选 ${j + 1}`;
      if (!cd || typeof cd !== 'object') {
        errors.push(`${at}：数据缺失。`);
        return;
      }
      if (typeof cd.canvasId !== 'string' || !ids.has(cd.canvasId)) {
        errors.push(`${at}：所属帆布不存在或未指定。`);
      }
      if (!isInt(cd.x) || cd.x < 0) errors.push(`${at}：左上 x 须为非负整数。`);
      if (!isInt(cd.y) || cd.y < 0) errors.push(`${at}：左上 y 须为非负整数。`);
      if (!isInt(cd.width) || cd.width <= 0) errors.push(`${at}：裁切宽度须为正整数。`);
      if (!isInt(cd.height) || cd.height <= 0) errors.push(`${at}：裁切高度须为正整数。`);
      if (!ROTATIONS.includes(cd.rotation)) errors.push(`${at}：旋转方向须为 none 或 cw90（顺时针 90°）。`);
    });
  });

  return { ok: errors.length === 0, errors };
}

/** 矩形正面积重叠（边界相接不算）。 */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
}

/** 求两矩形交叠面积（0 表示不重叠）。 */
export function intersectionArea(a, b) {
  const ow = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const oh = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return ow > 0 && oh > 0 ? ow * oh : 0;
}
