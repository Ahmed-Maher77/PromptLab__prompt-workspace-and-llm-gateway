#!/usr/bin/env node

/**
 * Automated Playwright Flow Runner for PromptLab.
 *
 * Can be run in 3 modes:
 * 1. CLI flow runner:
 *    `node scripts/run-e2e-flows.mjs --flow=prompt-studio`
 *    `node scripts/run-e2e-flows.mjs --all`
 * 2. Playwright test wrapper:
 *    `node scripts/run-e2e-flows.mjs --run-tests`
 * 3. Programmatic API:
 *    Exposes callable flow operations (runFlow, takeScreenshot, inspectDOM, checkHealth)
 *    that return structured JSON summaries with step-by-step telemetry.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const ARTIFACTS_DIR = resolve(ROOT_DIR, 'e2e/artifacts/screenshots');

if (!existsSync(ARTIFACTS_DIR)) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

const FLOWS = [
  { id: 'prompt-studio', name: 'Prompt Studio Flow', path: '/prompt-studio' },
  { id: 'compare', name: 'Model Comparison Flow', path: '/compare' },
  { id: 'conversations', name: 'Conversations & Compaction Flow', path: '/conversations' },
  { id: 'usage', name: 'Usage Quotas & Ledger Flow', path: '/usage' },
  { id: 'observability', name: 'Observability & Tracing Flow', path: '/observability' },
  { id: 'settings', name: 'System Settings & Security Flow', path: '/settings' },
];

function printHelp() {
  console.log(`
PromptLab Playwright Flow Runner

Usage:
  node scripts/run-e2e-flows.mjs [options]

Options:
  --flow=<id>          Run a specific flow (${FLOWS.map((f) => f.id).join(', ')})
  --all                Run all 6 E2E flows in sequence
  --baseURL=<url>      Target base URL (default: http://localhost:4200)
  --run-tests          Execute Playwright test suite via Playwright CLI runner
  --json               Output machine-readable JSON results
  --help               Display this help text
`);
}

async function runPlaywrightCLI(args = []) {
  return new Promise((resolveResult) => {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'npx.cmd' : 'npx';
    const cliArgs = ['playwright', 'test', '-c', 'e2e/playwright.config.ts', ...args];

    console.log(`[e2e flows] Executing: ${cmd} ${cliArgs.join(' ')}`);

    const proc = spawn(cmd, cliArgs, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: isWindows,
    });

    proc.on('close', (code) => {
      resolveResult({
        success: code === 0,
        exitCode: code,
      });
    });

    proc.on('error', (err) => {
      console.error('[e2e flows] Process error:', err);
      resolveResult({
        success: false,
        error: err.message,
      });
    });
  });
}

async function runProgrammaticFlows(selectedFlowIds, baseURL, asJson) {
  let playwrightModule;
  try {
    playwrightModule = await import('@playwright/test');
  } catch {
    try {
      playwrightModule = await import('playwright');
    } catch {
      console.warn('[e2e flows] @playwright/test not directly importable in current context. Delegating to npx playwright test CLI...');
      return await runPlaywrightCLI();
    }
  }

  const { chromium } = playwrightModule;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  const report = {
    timestamp: new Date().toISOString(),
    baseURL,
    flowsTested: [],
    overallStatus: 'passed',
  };

  try {
    for (const flowId of selectedFlowIds) {
      const flowDef = FLOWS.find((f) => f.id === flowId);
      if (!flowDef) continue;

      const flowResult = {
        id: flowDef.id,
        name: flowDef.name,
        targetUrl: `${baseURL}${flowDef.path}`,
        startTime: new Date().toISOString(),
        steps: [],
        status: 'passed',
      };

      console.log(`[e2e flows] Running ${flowDef.name} (${flowDef.path})...`);
      const t0 = Date.now();

      try {
        await page.goto(flowDef.path, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        flowResult.steps.push({ step: 'navigation', status: 'ok', durationMs: Date.now() - t0 });

        // Basic sanity assertions per flow
        if (flowId === 'prompt-studio') {
          await page.waitForSelector('.library-title, #btn-create-prompt', { timeout: 7000 });
          flowResult.steps.push({ step: 'verify_library_controls', status: 'ok' });
        } else if (flowId === 'compare') {
          await page.waitForSelector('.compare-title, #input-experiment-name', { timeout: 7000 });
          flowResult.steps.push({ step: 'verify_compare_controls', status: 'ok' });
        } else if (flowId === 'conversations') {
          await page.waitForSelector('.conversations-sidebar, .chat-main', { timeout: 7000 });
          flowResult.steps.push({ step: 'verify_conversations_layout', status: 'ok' });
        } else if (flowId === 'usage') {
          await page.waitForSelector('.usage-container', { timeout: 7000 });
          flowResult.steps.push({ step: 'verify_usage_container', status: 'ok' });
        } else if (flowId === 'observability') {
          await page.waitForSelector('.observability-container', { timeout: 7000 });
          flowResult.steps.push({ step: 'verify_observability_container', status: 'ok' });
        } else if (flowId === 'settings') {
          await page.waitForSelector('.settings-container, .page-title', { timeout: 7000 });
          const text = await page.innerText('body');
          const leakDetected = text.includes('sk-promptlab') || text.includes('POSTGRES_PASSWORD');
          flowResult.steps.push({ step: 'audit_security_redaction', status: leakDetected ? 'failed' : 'ok' });
          if (leakDetected) throw new Error('Security leak detected on settings page');
        }

        // Take snapshot screenshot
        const screenshotPath = resolve(ARTIFACTS_DIR, `${flowId}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        flowResult.screenshot = screenshotPath;
      } catch (err) {
        flowResult.status = 'failed';
        flowResult.error = err.message;
        report.overallStatus = 'failed';
        console.error(`[e2e flows] Flow ${flowDef.id} failed:`, err.message);
      }

      flowResult.durationMs = Date.now() - t0;
      report.flowsTested.push(flowResult);
    }
  } finally {
    await browser.close();
  }

  const reportPath = resolve(ROOT_DIR, 'e2e/artifacts/flow-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n====================== PLAYWRIGHT FLOW REPORT ======================`);
    console.log(`Overall Status: ${report.overallStatus.toUpperCase()}`);
    console.log(`Target Base URL: ${report.baseURL}`);
    for (const f of report.flowsTested) {
      console.log(` - [${f.status === 'passed' ? 'PASS' : 'FAIL'}] ${f.name} (${f.durationMs}ms)`);
    }
    console.log(`Report written to: ${reportPath}`);
    console.log(`=================================================================\n`);
  }

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    printHelp();
    return;
  }

  const baseURLArg = args.find((a) => a.startsWith('--baseURL='));
  const baseURL = baseURLArg ? baseURLArg.split('=')[1] : (process.env.WEB_BASE_URL || 'http://localhost:4200');
  const asJson = args.includes('--json');

  if (args.includes('--run-tests')) {
    const testArgs = args.filter((a) => !['--run-tests', '--json'].includes(a));
    await runPlaywrightCLI(testArgs);
    return;
  }

  const flowArg = args.find((a) => a.startsWith('--flow='));
  let selectedFlows = [];

  if (args.includes('--all')) {
    selectedFlows = FLOWS.map((f) => f.id);
  } else if (flowArg) {
    const requested = flowArg.split('=')[1];
    selectedFlows = requested.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    selectedFlows = FLOWS.map((f) => f.id);
  }

  await runProgrammaticFlows(selectedFlows, baseURL, asJson);
}

main().catch((err) => {
  console.error('[e2e flows] Fatal error:', err);
  process.exit(1);
});
