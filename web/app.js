/**
 * 帆装师排版工作台 · 浏览器端
 *  - 帆布/补片/候选的录入与编辑（数量按题面限制）
 *  - 点击排版后展示：帆布示意（可裁区、禁裁边、采用裁片）、采用/排除明细
 *  - 草稿修改后旧结论立即标记为失效
 */

const $ = (sel) => document.querySelector(sel);

const state = {
  version: 0,
  draft: null,
  result: null, // { version, output }
  resultVersion: null, // 当前页面上展示的结论对应的草稿版本
};

const GRAIN_TEXT = { warp: '经纱 warp', weft: '纬纱 weft' };
const ROT_TEXT = { none: '不旋转', cw90: '顺时针 90°' };
const PATCH_COLORS = ['#2e7d43', '#1f6aa5', '#9c4a1a', '#7a3e9d', '#5d6d2c'];

// ---------- 数据访问 ----------

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.errors || [`HTTP ${res.status}`]);
  return body;
}
class ApiError extends Error {
  constructor(errors) { super(errors.join('\n')); this.errors = errors; }
}

async function load() {
  const r = await api('/api/draft');
  state.draft = r.draft;
  state.version = r.version;
  state.result = r.result;
  state.resultVersion = r.result ? r.result.version : null;
  renderAll();
}

function markDirty() {
  // 任何录入变更都使旧结论在 UI 上立即失效（保存后服务端版本推进）。
  if (state.result) {
    state.resultVersion = -1;
    renderResult();
  }
}

// ---------- 录入区渲染 ----------

function renderCanvases() {
  const root = $('#canvases');
  root.innerHTML = '';
  state.draft.canvases.forEach((c, ci) => {
    const div = document.createElement('div');
    div.className = 'entity';
    div.innerHTML = `
      <div class="entity-head">
        <span class="idx">帆布 ${ci + 1}</span>
        <input class="w-id" data-k="id" placeholder="编号" value="${escapeHtml(c.id)}" />
        <input class="w-name" data-k="name" placeholder="名称" value="${escapeHtml(c.name)}" />
        <span class="grow"></span>
        <button type="button" class="mini danger" data-act="del-canvas">删除</button>
      </div>
      <div class="row">
        <span class="field"><label>宽</label><input type="number" min="1" step="1" data-k="width" value="${c.width}" /></span>
        <span class="field"><label>高</label><input type="number" min="1" step="1" data-k="height" value="${c.height}" /></span>
        <span class="field"><label>纤维方向</label>
          <select class="w-canvas" data-k="grain">
            <option value="warp" ${c.grain === 'warp' ? 'selected' : ''}>经纱 warp（沿高）</option>
            <option value="weft" ${c.grain === 'weft' ? 'selected' : ''}>纬纱 weft（沿高）</option>
          </select>
        </span>
        <span class="field"><label>边缘禁裁宽度</label><input type="number" min="0" step="1" data-k="margin" value="${c.margin}" /></span>
      </div>`;
    div.querySelector('[data-act="del-canvas"]').addEventListener('click', () => {
      state.draft.canvases.splice(ci, 1);
      renderAll(); markDirty();
    });
    div.querySelectorAll('input[data-k], select[data-k]').forEach((el) => {
      el.addEventListener('change', () => {
        const k = el.dataset.k;
        c[k] = el.tagName === 'SELECT' || k === 'id' || k === 'name' ? el.value : toInt(el.value);
        markDirty();
      });
    });
    root.appendChild(div);
  });
}

function renderPatches() {
  const root = $('#patches');
  root.innerHTML = '';
  state.draft.patches.forEach((p, pi) => {
    const div = document.createElement('div');
    div.className = 'entity';
    div.innerHTML = `
      <div class="entity-head">
        <span class="idx">补片 ${pi + 1}</span>
        <input class="w-id" data-k="id" placeholder="编号" value="${escapeHtml(p.id || '')}" />
        <input class="w-name" data-k="name" placeholder="名称" value="${escapeHtml(p.name)}" />
        <span class="grow"></span>
        <button type="button" class="mini danger" data-act="del-patch">删除</button>
      </div>
      <div class="row">
        <span class="field"><label>毛坯宽</label><input type="number" min="1" step="1" data-k="width" value="${p.width}" /></span>
        <span class="field"><label>毛坯高</label><input type="number" min="1" step="1" data-k="height" value="${p.height}" /></span>
        <span class="field"><label>纤维方向</label>
          <select class="w-canvas" data-k="grain">
            <option value="warp" ${p.grain === 'warp' ? 'selected' : ''}>经纱 warp</option>
            <option value="weft" ${p.grain === 'weft' ? 'selected' : ''}>纬纱 weft</option>
          </select>
        </span>
      </div>
      <div class="cands">
        <div class="entity-head"><span class="reason">批准候选（${p.candidates.length} 个，序号从 1 计；选择顺序影响字典序平局判定）</span>
          <span class="grow"></span>
          <button type="button" class="mini" data-act="add-cand">＋ 候选</button>
        </div>
        <div data-cands></div>
      </div>`;
    div.querySelector('[data-act="del-patch"]').addEventListener('click', () => {
      state.draft.patches.splice(pi, 1);
      renderAll(); markDirty();
    });
    div.querySelector('[data-act="add-cand"]').addEventListener('click', () => {
      if (p.candidates.length >= 4) return;
      const first = state.draft.canvases[0];
      p.candidates.push({
        canvasId: first ? first.id : '', x: 0, y: 0,
        width: p.width, height: p.height, rotation: 'none',
      });
      renderAll(); markDirty();
    });
    div.querySelectorAll('input[data-k], select[data-k]').forEach((el) => {
      el.addEventListener('change', () => {
        const k = el.dataset.k;
        p[k] = el.tagName === 'SELECT' || k === 'id' || k === 'name' ? el.value : toInt(el.value);
        markDirty();
      });
    });

    const candsBox = div.querySelector('[data-cands]');
    p.candidates.forEach((cd, cdi) => {
      const row = document.createElement('div');
      row.className = 'cand';
      row.dataset.patch = String(pi);
      row.dataset.cand = String(cdi);
      row.innerHTML = candidateRowHtml(cd, cdi, p);
      row.querySelector('[data-act="del-cand"]').addEventListener('click', () => {
        p.candidates.splice(cdi, 1);
        renderAll(); markDirty();
      });
      row.querySelectorAll('input[data-cf], select[data-cf]').forEach((el) => {
        el.addEventListener('change', () => {
          const k = el.dataset.cf;
          cd[k] = el.tagName === 'SELECT' ? el.value : toInt(el.value);
          markDirty();
        });
      });
      candsBox.appendChild(row);
    });
    root.appendChild(div);
  });
}

function candidateRowHtml(cd, cdi, patch) {
  const opts = state.draft.canvases.map((c) =>
    `<option value="${escapeHtml(c.id)}" ${c.id === cd.canvasId ? 'selected' : ''}>${escapeHtml(c.id)} ${escapeHtml(c.name)}</option>`).join('');
  return `
    <span class="cnum">#${cdi + 1}</span>
    <span class="field"><label>帆布</label>
      <select class="w-canvas" data-cf="canvasId">${opts}</select>
    </span>
    <span class="field"><label>左上 x</label><input type="number" min="0" step="1" data-cf="x" value="${cd.x}" /></span>
    <span class="field"><label>左上 y</label><input type="number" min="0" step="1" data-cf="y" value="${cd.y}" /></span>
    <span class="field"><label>宽</label><input type="number" min="1" step="1" data-cf="width" value="${cd.width}" /></span>
    <span class="field"><label>高</label><input type="number" min="1" step="1" data-cf="height" value="${cd.height}" /></span>
    <span class="field"><label>旋转</label>
      <select data-cf="rotation">
        <option value="none" ${cd.rotation === 'none' ? 'selected' : ''}>不旋转</option>
        <option value="cw90" ${cd.rotation === 'cw90' ? 'selected' : ''}>顺时针 90°</option>
      </select>
    </span>
    <button type="button" class="mini danger" data-act="del-cand">移除</button>`;
}

// ---------- 结论区 ----------

function renderResult() {
  const body = $('#result-body');
  const banner = $('#stale-banner');
  const r = state.result;

  if (!r) {
    banner.classList.add('hidden');
    body.innerHTML = '<p class="hint">尚未排版。</p>';
    return;
  }

  const stale = r.version !== state.version || state.resultVersion === -1;
  banner.classList.toggle('hidden', !stale);

  const out = r.output;
  if (!out.feasible) {
    body.innerHTML = renderInfeasible(out);
    return;
  }
  body.innerHTML = renderFeasible(out);
}

function renderFeasible(out) {
  const { objective, usage, alternatives } = out;
  const sheets = usage.map((u) => sheetSvg(u)).join('');
  const tables = out.candidateEvals.map((evs, pi) => {
    const p = state.draft.patches[pi];
    const chosen = out.assignment[pi];
    const rows = evs.map((ev, ci) => {
      const alt = alternatives[pi][ci];
      const isChosen = ci === chosen;
      const cls = isChosen ? 'chosen' : ev.compatible ? 'excluded' : 'incompat';
      const tag = altTag(alt, isChosen);
      const detail = isChosen
        ? `<span class="reason">采用。落于 <b>${canvasName(ev.canvasId)}</b> (${ev.rect.x},${ev.rect.y})，实际裁切 ${ev.rect.width}×${ev.rect.height}${ev.rotation === 'cw90' ? '（旋转 90°）' : ''}。</span>`
        : altDetail(p, pi, ci, ev, alt);
      return `<tr class="${cls}">
        <td>候选 ${ci + 1} ${tag}</td>
        <td>${escapeHtml(canvasName(ev.canvasId))}</td>
        <td>(${ev.rect ? ev.rect.x : '—'},${ev.rect ? ev.rect.y : '—'}) ${ev.rect ? `${ev.rect.width}×${ev.rect.height}` : ''} ${ROT_TEXT[ev.rotation] || ''}</td>
        <td>${detail}</td>
      </tr>`;
    }).join('');
    return `<div class="canvas-sheet">
      <h3>补片 ${pi + 1} · ${escapeHtml(p.name)}（${GRAIN_TEXT[p.grain]}，毛坯 ${p.width}×${p.height}）→ 采用候选 ${chosen + 1}</h3>
      <table class="detail-table">
        <thead><tr><th style="width:130px">候选</th><th style="width:120px">所属帆布</th><th style="width:180px">裁切矩形 / 旋转</th><th>采用与排除理由</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');

  return `
    <p class="verdict-ok">✔ 存在可行联合排版。</p>
    <div class="summary">
      <span class="metric">使用帆布 <b>${objective.canvasCount}</b> 张</span>
      <span class="metric">已用帆布剩余面积最大值 <b>${objective.maxRemaining}</b></span>
      <span class="metric">采用候选序号（按补片顺序）<b>[${objective.tuple.join(', ')}]</b></span>
    </div>
    ${sheets}
    <h3 style="color:var(--navy);margin-top:18px">采用与排除明细</h3>
    ${tables}`;
}

function renderInfeasible(out) {
  const { infeasible } = out;
  let head;
  if (infeasible.firstPatchIndex !== null && infeasible.firstPatchIndex !== undefined) {
    const pi = infeasible.firstPatchIndex;
    const p = state.draft.patches[pi];
    const reasons = out.candidateEvals[pi]
      .map((ev, ci) => `<li>候选 ${ci + 1}（${escapeHtml(canvasName(ev.canvasId))}）：${ev.compatible ? '意外可兼容' : escapeHtml(ev.reasons.join('；'))}</li>`)
      .join('');
    head = `
      <p class="verdict-bad">✘ 无可行排版。按补片录入顺序，首块不存在任何可兼容候选的是
        <b>补片 ${pi + 1} · ${escapeHtml(p.name)}</b>——它的全部候选都无法单独落位：</p>
      <ul>${reasons}</ul>
      <p class="reason">请先修改该补片或帆布草稿（放宽禁裁边、调整坐标/旋转、更换同纤维方向帆布），再重新排版。</p>`;
  } else {
    const top = infeasible.conflicts.slice(0, 12).map((cf) =>
      `<li>「${escapeHtml(state.draft.patches[cf.patchAIndex].name)}」候选 ${cf.candidateAIndex + 1} 与
        「${escapeHtml(state.draft.patches[cf.patchBIndex].name)}」候选 ${cf.candidateBIndex + 1}
        在 ${escapeHtml(canvasName(cf.canvasId))} 上正面积重叠 ${cf.overlapArea}</li>`).join('');
    head = `
      <p class="verdict-bad">✘ 每块补片都有可兼容候选，但候选之间的正面积冲突致使无法同时落位。</p>
      <p class="reason">检测到的候选对冲突（节选）：</p><ul>${top}</ul>
      <p class="reason">请增加候选位置或更换帆布后重新排版。</p>`;
  }

  // 即使无解也给出静态候选评估明细。
  const evals = out.candidateEvals.map((evs, pi) => {
    const p = state.draft.patches[pi];
    const rows = evs.map((ev, ci) => `<tr class="${ev.compatible ? '' : 'incompat'}">
      <td>候选 ${ci + 1}</td>
      <td>${escapeHtml(canvasName(ev.canvasId))}</td>
      <td>${ev.rect ? `(${ev.rect.x},${ev.rect.y}) ${ev.rect.width}×${ev.rect.height}` : '—'}</td>
      <td>${ev.compatible ? '<span class="reason">单看本候选可兼容，但联合落位时被冲突堵死。</span>' : `<span class="reason bad">${escapeHtml(ev.reasons.join('；'))}</span>`}</td>
    </tr>`).join('');
    return `<div class="canvas-sheet">
      <h3>补片 ${pi + 1} · ${escapeHtml(p.name)}</h3>
      <table class="detail-table"><thead><tr><th>候选</th><th>帆布</th><th>矩形</th><th>评估</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }).join('');

  return head + evals;
}

function altTag(alt, isChosen) {
  if (isChosen) return '<span class="tag chosen">采用</span>';
  switch (alt.kind) {
    case 'incompatible': return '<span class="tag incompatible">不可采用</span>';
    case 'blocks': return '<span class="tag blocks">强制则无解</span>';
    case 'dominated': return '<span class="tag dominated">可行但更差</span>';
    case 'equivalent': return '<span class="tag dominated">平局落选</span>';
    default: return '';
  }
}

function altDetail(p, pi, ci, ev, alt) {
  if (alt.kind === 'incompatible') {
    return `<span class="reason bad">${escapeHtml(alt.reasons.join('；'))}</span>`;
  }
  if (alt.kind === 'blocks') return `<span class="reason bad">${escapeHtml(alt.detail)}</span>`;
  if (alt.kind === 'dominated' || alt.kind === 'equivalent') {
    return `<span class="reason">${escapeHtml(alt.detail)}</span>`;
  }
  return '<span class="reason muted">未采用。</span>';
}

// ---------- SVG 帆布示意 ----------

function sheetSvg(u) {
  const pad = 14;
  const maxW = 520;
  const scale = Math.min(maxW / u.width, 3.6);
  const w = u.width * scale;
  const h = u.height * scale;
  const cut = u.cuttable;

  const placedRects = u.placed.map((pl, i) => {
    const color = PATCH_COLORS[pl.patchIndex % PATCH_COLORS.length];
    return `
      <rect x="${pl.rect.x * scale}" y="${pl.rect.y * scale}"
        width="${pl.rect.width * scale}" height="${pl.rect.height * scale}"
        fill="${color}" fill-opacity="0.72" stroke="${color}" stroke-width="1.5" />
      <text x="${pl.rect.x * scale + 4}" y="${pl.rect.y * scale + 15}"
        font-size="12" fill="#fff" font-weight="700">P${pl.patchIndex + 1}·#${pl.candidateIndex + 1}</text>`;
  }).join('');

  // 未采用但需提示的候选（虚线），从全局 alternatives 拿：这里只画采用布上被采用补片同布的落选候选
  const ghost = ghostRects(u, scale);

  const grainArrow = u.grain === 'warp'
    ? `<line x1="${w - 18}" y1="8" x2="${w - 18}" y2="34" stroke="#6b5c3c" stroke-width="1.4" marker-end="url(#arr)"/><text x="${w - 44}" y="26" font-size="10" fill="#6b5c3c">经</text>`
    : `<line x1="${w - 34}" y1="${h - 12}" x2="${w - 8}" y2="${h - 12}" stroke="#6b5c3c" stroke-width="1.4" marker-end="url(#arr)"/><text x="${w - 30}" y="${h - 18}" font-size="10" fill="#6b5c3c">纬</text>`;

  return `
  <div class="canvas-sheet ${u.inUse ? '' : 'idle'}">
    <h3>${escapeHtml(u.canvasName)}（${escapeHtml(u.canvasId)}）
      <span class="legend">${u.width}×${u.height}，${GRAIN_TEXT[u.grain]}，四边禁裁 ${u.margin}；
      ${u.inUse ? `已用 ${u.placed.length} 片共 ${u.used}，剩余 ${u.remaining}` : '本方案未使用（剩余 ' + u.remaining + '）'}</span>
    </h3>
    <div class="sheet-wrap">
      <svg class="sheet" width="${w + pad * 2}" height="${h + pad * 2}" viewBox="0 0 ${w + pad * 2} ${h + pad * 2}">
        <defs>
          <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#6b5c3c"/>
          </marker>
          <pattern id="hatch-${u.canvasId}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="#c9b586" stroke-width="2"/>
          </pattern>
        </defs>
        <g transform="translate(${pad},${pad})">
          <rect x="0" y="0" width="${w}" height="${h}" fill="#e9dfc6"/>
          <rect x="0" y="0" width="${w}" height="${h}" fill="url(#hatch-${u.canvasId})" opacity="0.55"/>
          <rect x="${cut.x * scale}" y="${cut.y * scale}" width="${cut.width * scale}" height="${cut.height * scale}"
            fill="#f8f2df" stroke="#8a7a50" stroke-dasharray="4 3"/>
          ${ghost}
          ${placedRects}
          ${grainArrow}
        </g>
      </svg>
    </div>
  </div>`;
}

function ghostRects(u, scale) {
  const r = state.result;
  if (!r || !r.output.feasible) return '';
  const out = r.output;
  let html = '';
  state.draft.patches.forEach((p, pi) => {
    if (out.assignment[pi] === undefined) return;
    p.candidates.forEach((cd, ci) => {
      if (ci === out.assignment[pi]) return;
      if (cd.canvasId !== u.canvasId) return;
      const ev = out.candidateEvals[pi][ci];
      if (!ev.rect) return;
      const alt = out.alternatives[pi][ci];
      if (alt.kind === 'incompatible') return; // 不兼容候选不画，避免噪声
      const dash = alt.kind === 'blocks' ? '#b03a2e' : '#9a6a08';
      html += `<rect x="${ev.rect.x * scale}" y="${ev.rect.y * scale}"
        width="${ev.rect.width * scale}" height="${ev.rect.height * scale}"
        fill="none" stroke="${dash}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    });
  });
  return html;
}

function canvasName(id) {
  const c = state.draft.canvases.find((x) => x.id === id);
  return c ? `${c.name}` : id;
}

function toInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---------- 全局渲染与事件 ----------

function renderAll() {
  renderCanvases();
  renderPatches();
  renderResult();
  // 数量约束按钮可用性
  $('#btn-add-canvas').disabled = state.draft.canvases.length >= 3;
  $('#btn-add-patch').disabled = state.draft.patches.length >= 5;
}

function setStatus(text, cls = '') {
  const el = $('#status');
  el.textContent = text;
  el.className = `status ${cls}`;
}

function showErrors(errors) {
  const box = $('#errors');
  box.textContent = ['草稿未通过校验：', ...errors].join('\n• ');
  box.classList.remove('hidden');
}

async function onSave() {
  try {
    const r = await api('/api/draft', { method: 'PUT', body: JSON.stringify({ draft: state.draft }) });
    state.version = r.version;
    state.result = null;
    state.resultVersion = null;
    $('#errors').classList.add('hidden');
    renderResult();
    setStatus('草稿已保存，旧排版结论已失效', 'saved');
  } catch (e) {
    showErrors(e.errors || [e.message]);
    setStatus('保存被拒绝', 'error');
  }
}

async function onPlan() {
  setStatus('排版中…');
  try {
    // 先保存当前编辑（保证结论针对当前草稿版本），再求方案。
    const save = await api('/api/draft', { method: 'PUT', body: JSON.stringify({ draft: state.draft }) });
    state.version = save.version;
    const r = await api('/api/plan', { method: 'POST' });
    state.result = r.result;
    state.resultVersion = r.result.version;
    $('#errors').classList.add('hidden');
    renderResult();
    setStatus(r.result.output.feasible ? `排版完成（草稿版本 v${r.version}）` : '排版完成：无解', 'saved');
  } catch (e) {
    showErrors(e.errors || [e.message]);
    setStatus('无法排版：草稿未通过校验', 'error');
  }
}

async function onReset() {
  const r = await api('/api/reset', { method: 'POST' });
  state.draft = r.draft;
  state.version = r.version;
  state.result = null;
  state.resultVersion = null;
  $('#errors').classList.add('hidden');
  renderAll();
  setStatus('已恢复内置示例草稿', 'saved');
}

$('#btn-plan').addEventListener('click', onPlan);
$('#btn-save').addEventListener('click', onSave);
$('#btn-reset').addEventListener('click', onReset);

load().catch((e) => {
  $('#result-body').innerHTML = `<p class="verdict-bad">加载草稿失败：${escapeHtml(e.message)}</p>`;
});
