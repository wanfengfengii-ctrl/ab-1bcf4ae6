/**
 * 内置示例草稿（2 张帆布、3 块补片，每补片 3–4 个候选）。
 *
 * 帆布甲 C1：经线 warp；帆布乙 C2：纬线 weft。
 *   - 小角补 P3（纬纱）只能落在乙布；方肘补 P2（经纱）只有甲布候选。
 *   - 大肘补 P1（经纱）候选 0 在甲布角落 (10,10)，看似就近省料，
 *     却与 P2 在甲布上全部 3 个可兼容候选（候选 4 本身越出可裁区）正面积重叠
 *     → 局部挑这个位置会令 P2 无处可裁。联合求解必须把 P1 改放到乙布（旋转 90°）。
 *   - 小角补 P3（纬纱）只能落在乙布或经旋转落在甲布；若也堆到乙布，
 *     乙布剩余面积成为最大短板，故选甲布候选 4 摊匀占用（第二级目标）。
 *   - P3 候选 3 在甲布纤维方向不符（不旋转）；候选 4 同位置旋转 90° 后相符。
 */
export const defaultDraft = Object.freeze({
  canvases: [
    { id: 'C1', name: '主帆布甲', width: 120, height: 100, grain: 'warp', margin: 8 },
    { id: 'C2', name: '备用帆布乙', width: 120, height: 100, grain: 'weft', margin: 8 },
  ],
  patches: [
    {
      id: 'P1',
      name: '大肘补',
      width: 40,
      height: 60,
      grain: 'warp',
      candidates: [
        { canvasId: 'C1', x: 10, y: 10, width: 40, height: 60, rotation: 'none' },
        { canvasId: 'C2', x: 10, y: 10, width: 40, height: 60, rotation: 'cw90' },
        { canvasId: 'C2', x: 10, y: 50, width: 40, height: 60, rotation: 'cw90' },
      ],
    },
    {
      id: 'P2',
      name: '方肘补',
      width: 30,
      height: 30,
      grain: 'warp',
      candidates: [
        { canvasId: 'C1', x: 12, y: 12, width: 30, height: 30, rotation: 'none' },
        { canvasId: 'C1', x: 15, y: 42, width: 30, height: 30, rotation: 'none' },
        { canvasId: 'C1', x: 45, y: 15, width: 30, height: 30, rotation: 'none' },
        { canvasId: 'C1', x: 105, y: 85, width: 30, height: 30, rotation: 'none' },
      ],
    },
    {
      id: 'P3',
      name: '小角补',
      width: 20,
      height: 20,
      grain: 'weft',
      candidates: [
        { canvasId: 'C2', x: 70, y: 20, width: 20, height: 20, rotation: 'none' },
        { canvasId: 'C2', x: 70, y: 60, width: 20, height: 20, rotation: 'none' },
        { canvasId: 'C1', x: 80, y: 20, width: 20, height: 20, rotation: 'none' },
        { canvasId: 'C1', x: 80, y: 20, width: 20, height: 20, rotation: 'cw90' },
      ],
    },
  ],
});
