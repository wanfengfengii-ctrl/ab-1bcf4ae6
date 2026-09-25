/**
 * verify 一次性服务：依次运行
 *   1) 代码测试（node --test，test/ 下的领域单测）
 *   2) 前端构建（esbuild → dist/）
 *   3) 候选冲突业务冒烟（默认草稿的联合求解断言）
 * 以退出码报告总体结果：0 全部通过；非 0 存在失败。自身运行结束即退出，
 * 不监听端口（供 docker compose run --rm verify 使用）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSmoke } from './smoke.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function run(cmd, args, label) {
  return new Promise((resolve) => {
    console.log(`\n=== [verify] ${label}：${cmd} ${args.join(' ')} ===`);
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: process.env });
    child.on('close', (code) => {
      console.log(`=== [verify] ${label} 退出码 ${code} ===`);
      resolve(code ?? 1);
    });
    child.on('error', (err) => {
      console.error(`=== [verify] ${label} 无法启动：${err.message} ===`);
      resolve(1);
    });
  });
}

async function main() {
  const results = [];

  const testCode = await run(process.execPath, ['--test'], '代码测试');
  results.push(['代码测试', testCode]);

  const buildCode = await run(process.execPath, ['scripts/build.js'], '前端构建');
  results.push(['前端构建', buildCode]);

  console.log('\n=== [verify] 候选冲突业务冒烟 ===');
  let smokeCode = 0;
  try {
    const smoke = runSmoke();
    for (const c of smoke.checks) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` —— ${c.detail}` : ''}`);
    }
    smokeCode = smoke.passed ? 0 : 1;
  } catch (err) {
    console.error('冒烟执行异常：', err);
    smokeCode = 1;
  }
  console.log(`=== [verify] 业务冒烟 退出码 ${smokeCode} ===`);
  results.push(['候选冲突业务冒烟', smokeCode]);

  console.log('\n=== [verify] 汇总 ===');
  let failed = 0;
  for (const [name, code] of results) {
    const ok = code === 0;
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}（退出码 ${code}）`);
  }

  if (failed > 0) {
    console.log(`\n[verify] ${failed} 个阶段失败，退出码 1。`);
    process.exit(1);
  }
  console.log('\n[verify] 全部阶段通过，退出码 0。');
  process.exit(0);
}

main();
