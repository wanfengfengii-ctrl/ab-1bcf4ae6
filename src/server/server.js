import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { validateDraft } from '../core/validation.js';
import { planLayout } from '../core/planner.js';
import { defaultDraft } from './defaultDraft.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // 内存中的“草稿 + 结论”。结论仅对生成它的草稿版本有效（version 单调递增）。
  let currentVersion = 0;
  let draft = structuredClone(defaultDraft);
  let result = null; // { version, output }

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', version: currentVersion });
  });

  app.get('/api/draft', (_req, res) => {
    res.json({ version: currentVersion, draft, result });
  });

  // 保存草稿（任何修改都会使旧结论失效）。
  app.put('/api/draft', (req, res) => {
    const incoming = req.body && req.body.draft ? req.body.draft : null;
    const check = validateDraft(incoming);
    if (!check.ok) {
      return res.status(400).json({ ok: false, errors: check.errors });
    }
    currentVersion += 1;
    draft = incoming;
    result = null; // 旧结论随草稿修改立即失效
    return res.json({ ok: true, version: currentVersion });
  });

  // 恢复内置示例草稿（同样使旧结论失效）。
  app.post('/api/reset', (_req, res) => {
    currentVersion += 1;
    draft = structuredClone(defaultDraft);
    result = null;
    res.json({ ok: true, version: currentVersion, draft });
  });

  // 运行联合排版；结论与当前草稿版本绑定。
  app.post('/api/plan', (_req, res) => {
    const output = planLayout(draft);
    result = { version: currentVersion, output };
    res.json({ ok: true, version: currentVersion, result });
  });

  const distDir = path.join(root, 'dist');
  const webDir = path.join(root, 'web');
  const staticDir = existsSync(distDir) ? distDir : webDir;
  app.use(express.static(staticDir));
  app.get('/', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createApp().listen(PORT, HOST, () => {
    console.log(`[web] 帆布排版工作台已启动：http://${HOST}:${PORT}（静态资源目录：${existsSync(path.join(root, 'dist')) ? 'dist' : 'web'}）`);
  });

  const shutdown = (sig) => {
    console.log(`[web] 收到 ${sig}，关闭中…`);
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
