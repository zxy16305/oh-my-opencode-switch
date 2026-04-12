/**
 * Benchmark script: Compare LB proxy vs Direct API response speeds
 *
 * Usage:
 *   node scripts/benchmark-lb-vs-direct.mjs --lb-profile <name> --direct-profile <name>
 *
 * This script uses the `opencode acp` protocol to send prompts and measure
 * TTFB (Time To First Byte) and total Duration for each request.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  iterations: 10,
  requestTimeout: 120000, // 120 seconds per request
  iterationDelay: 2000, // 2 seconds between iterations
  evidenceDir: '.sisyphus/evidence/benchmark',
};

const TEST_PROMPT = `请解释这个负载均衡算法中 score = (requestCount + 1) / effectiveWeight 公式的设计意图。为什么分子要加 1？如果去掉会有什么后果？请结合代码中的 tie-breaking 逻辑分析。`;

// ---------------------------------------------------------------------------
// ACP Client Class
// ---------------------------------------------------------------------------

class ACPClient {
  constructor(label) {
    this.label = label;
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.readline = null;
    this.initialized = false;
    this.firstTokenTime = null;
    this.currentRequestId = null;
  }

  /**
   * Start the opencode acp subprocess and initialize the session
   */
  async start() {
    return new Promise((resolve, reject) => {
      console.log(`[${this.label}] Starting opencode acp...`);

      this.process = spawn('opencode', ['acp'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        shell: true,
      });

      // Handle stderr
      this.process.stderr.on('data', (data) => {
        console.error(`[${this.label}] stderr: ${data.toString().trim()}`);
      });

      // Handle process errors
      this.process.on('error', (err) => {
        console.error(`[${this.label}] Process error:`, err.message);
        reject(err);
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        console.log(`[${this.label}] Process exited with code ${code}, signal ${signal}`);
        this.process = null;
      });

      // Set up readline to parse nd-JSON from stdout
      this.readline = createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });

      this.readline.on('line', (line) => {
        this._handleLine(line);
      });

      // Send initialize request
      const initId = ++this.requestId;
      const initRequest = {
        jsonrpc: '2.0',
        id: initId,
        method: 'initialize',
        params: {
          protocolVersion: 1,
          capabilities: {},
          clientInfo: {
            name: 'benchmark-script',
            version: '1.0.0',
          },
        },
      };

      // Set up pending request for initialize
      const initPromise = new Promise((res, rej) => {
        this.pendingRequests.set(initId, { resolve: res, reject: rej });
      });

      // Send initialize
      this._send(initRequest);

      // Wait for initialize response with timeout
      const timeout = setTimeout(() => {
        reject(new Error('Initialize timeout'));
      }, 30000);

      initPromise
        .then(() => {
          clearTimeout(timeout);
          this.initialized = true;
          console.log(`[${this.label}] Initialized successfully`);

          // Create a session after initialization
          return this._createSession();
        })
        .then(() => {
          resolve();
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  /**
   * Create a session for sending prompts
   */
  async _createSession() {
    const sessionId = ++this.requestId;
    const createSessionRequest = {
      jsonrpc: '2.0',
      id: sessionId,
      method: 'session/new',
      params: {
        cwd: process.cwd(),
        mcpServers: [],
      },
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Session create timeout'));
      }, 15000);

      this.pendingRequests.set(sessionId, {
        resolve: (result) => {
          clearTimeout(timeout);
          this.sessionId = result?.id || result?.sessionId;
          console.log(`[${this.label}] Session created: ${this.sessionId}`);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this._send(createSessionRequest);
    });
  }

  /**
   * Handle a line of output from stdout
   */
  _handleLine(line) {
    if (!line.trim()) return;

    try {
      const response = JSON.parse(line);

      // Check if this is a response to a pending request
      if (response.id !== undefined && this.pendingRequests.has(response.id)) {
        // Track first token time BEFORE resolving
        if (this.currentRequestId && response.id === this.currentRequestId) {
          if (this.firstTokenTime === null) {
            this.firstTokenTime = Date.now();
          }
        }

        const { resolve, reject } = this.pendingRequests.get(response.id);
        this.pendingRequests.delete(response.id);

        if (response.error) {
          reject(new Error(response.error.message || 'Unknown error'));
        } else {
          resolve(response.result);
        }
      }
    } catch (err) {
      // Ignore parse errors for non-JSON lines
    }
  }

  /**
   * Send a JSON-RPC message to the subprocess
   */
  _send(message) {
    if (!this.process || !this.process.stdin.writable) {
      throw new Error('Process not running or stdin not writable');
    }
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  /**
   * Send a prompt and return timing data
   */
  async sendPrompt(text) {
    if (!this.initialized) {
      throw new Error('Client not initialized');
    }

    const startTime = Date.now();
    this.firstTokenTime = null;

    const requestId = ++this.requestId;
    this.currentRequestId = requestId;

    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'session/prompt',
      params: {
        sessionId: this.sessionId,
        prompt: [
          {
            type: 'text',
            text: text,
          },
        ],
      },
    };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.currentRequestId = null;
        reject(new Error('Request timeout'));
      }, CONFIG.requestTimeout);

      // Set up pending request
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeout);
          const duration = Date.now() - startTime;
          const ttfb = this.firstTokenTime ? this.firstTokenTime - startTime : null;
          this.currentRequestId = null;

          resolve({
            ttfb,
            duration,
            responseLength: result?.content?.length || 0,
            error: null,
          });
        },
        reject: (err) => {
          clearTimeout(timeout);
          this.currentRequestId = null;
          reject(err);
        },
      });

      // Send the request
      try {
        this._send(request);
      } catch (err) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        this.currentRequestId = null;
        reject(err);
      }
    });
  }

  /**
   * Gracefully stop the subprocess
   */
  async stop() {
    if (!this.process) {
      return;
    }

    console.log(`[${this.label}] Stopping...`);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 3000);

      this.process.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      // Close stdin and send SIGTERM
      if (this.process.stdin.writable) {
        this.process.stdin.end();
      }
      this.process.kill('SIGTERM');
    });
  }
}

// ---------------------------------------------------------------------------
// Profile Switching
// ---------------------------------------------------------------------------

/**
 * Get the current active profile name
 */
async function getCurrentProfile() {
  return new Promise((resolve, reject) => {
    const proc = spawn('oos', ['profile', 'list', '--json'], {
      cwd: process.cwd(),
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        // Try alternative method
        resolve(null);
        return;
      }

      try {
        const profiles = JSON.parse(stdout);
        const active = profiles.find((p) => p.isActive);
        resolve(active ? active.name : null);
      } catch {
        resolve(null);
      }
    });

    proc.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Switch to a profile
 */
async function switchProfile(profileName) {
  return new Promise((resolve, reject) => {
    console.log(`Switching to profile: ${profileName}`);

    const proc = spawn('oos', ['profile', 'use', profileName], {
      cwd: process.cwd(),
      shell: true,
    });

    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to switch profile: ${stderr}`));
      } else {
        resolve();
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Test Executor
// ---------------------------------------------------------------------------

/**
 * Run a single test mode (LB or Direct)
 */
async function runTest(mode, profileName, evidenceDir) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running ${mode} test with profile: ${profileName}`);
  console.log(`${'='.repeat(60)}\n`);

  const results = [];
  let successCount = 0;

  // Switch to the profile
  try {
    await switchProfile(profileName);
  } catch (err) {
    console.error(`Failed to switch to profile ${profileName}:`, err.message);
    return { mode, results: [], successCount: 0, error: err.message };
  }

  // Create ACP client
  const client = new ACPClient(mode);

  try {
    await client.start();
  } catch (err) {
    console.error(`Failed to start ACP client:`, err.message);
    return { mode, results: [], successCount: 0, error: err.message };
  }

  // Run iterations
  for (let i = 1; i <= CONFIG.iterations; i++) {
    console.log(`[${mode}] Iteration ${i}/${CONFIG.iterations}...`);

    try {
      const result = await client.sendPrompt(TEST_PROMPT);
      results.push({
        iteration: i,
        ...result,
        timestamp: new Date().toISOString(),
      });
      successCount++;

      console.log(
        `  ttfb=${result.ttfb}ms, duration=${result.duration}ms, responseLength=${result.responseLength}`
      );

      // Save per-iteration data
      const iterationFile = path.join(evidenceDir, `${mode.toLowerCase()}-iteration-${i}.json`);
      await fs.writeFile(iterationFile, JSON.stringify(results[results.length - 1], null, 2));
    } catch (err) {
      console.error(`  Error: ${err.message}`);
      results.push({
        iteration: i,
        error: err.message,
        ttfb: null,
        duration: null,
        responseLength: null,
        timestamp: new Date().toISOString(),
      });
    }

    // Wait between iterations
    if (i < CONFIG.iterations) {
      await new Promise((r) => setTimeout(r, CONFIG.iterationDelay));
    }
  }

  // Stop the client
  await client.stop();

  return { mode, results, successCount };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function calculateStats(values) {
  if (values.length === 0) {
    return { avg: 0, min: 0, max: 0, p95: 0, trimmedAvg: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  // Trimmed average: remove highest and lowest values
  let trimmedAvg = 0;
  if (sorted.length > 2) {
    const trimmed = sorted.slice(1, -1);
    const trimmedSum = trimmed.reduce((a, b) => a + b, 0);
    trimmedAvg = Math.round(trimmedSum / trimmed.length);
  } else {
    trimmedAvg = Math.round(sum / sorted.length);
  }

  return {
    avg: Math.round(sum / sorted.length),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p95: sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1],
    trimmedAvg,
  };
}

// ---------------------------------------------------------------------------
// Report Generator
// ---------------------------------------------------------------------------

function generateReport(lbResult, directResult, evidenceDir) {
  const lbTtfbs = lbResult.results.filter((r) => r.ttfb !== null).map((r) => r.ttfb);
  const lbDurations = lbResult.results.filter((r) => r.duration !== null).map((r) => r.duration);

  const directTtfbs = directResult.results.filter((r) => r.ttfb !== null).map((r) => r.ttfb);
  const directDurations = directResult.results
    .filter((r) => r.duration !== null)
    .map((r) => r.duration);

  const lbTtfbStats = calculateStats(lbTtfbs);
  const lbDurationStats = calculateStats(lbDurations);
  const directTtfbStats = calculateStats(directTtfbs);
  const directDurationStats = calculateStats(directDurations);

  // Print report
  console.log('\n');
  console.log('============================================================');
  console.log('  LB vs Direct 速度对比测试报告');
  console.log('============================================================');
  console.log('');
  console.log('LB:');
  console.log(`  成功: ${lbResult.successCount}/${CONFIG.iterations}`);
  console.log(
    `  Duration:  avg=${lbDurationStats.avg}ms | min=${lbDurationStats.min}ms | max=${lbDurationStats.max}ms | p95=${lbDurationStats.p95}ms | trimmed=${lbDurationStats.trimmedAvg}ms`
  );
  console.log(
    `  TTFB:      avg=${lbTtfbStats.avg}ms | min=${lbTtfbStats.min}ms | max=${lbTtfbStats.max}ms | p95=${lbTtfbStats.p95}ms | trimmed=${lbTtfbStats.trimmedAvg}ms`
  );
  console.log('');
  console.log('Direct:');
  console.log(`  成功: ${directResult.successCount}/${CONFIG.iterations}`);
  console.log(
    `  Duration:  avg=${directDurationStats.avg}ms | min=${directDurationStats.min}ms | max=${directDurationStats.max}ms | p95=${directDurationStats.p95}ms | trimmed=${directDurationStats.trimmedAvg}ms`
  );
  console.log(
    `  TTFB:      avg=${directTtfbStats.avg}ms | min=${directTtfbStats.min}ms | max=${directTtfbStats.max}ms | p95=${directTtfbStats.p95}ms | trimmed=${directTtfbStats.trimmedAvg}ms`
  );
  console.log('');
  console.log('------------------------------------------------------------');
  console.log('  对比结果:');

  const lbAvgDuration = lbDurationStats.avg;
  const directAvgDuration = directDurationStats.avg;
  const lbTrimmedAvg = lbDurationStats.trimmedAvg;
  const directTrimmedAvg = directDurationStats.trimmedAvg;
  const diff = lbAvgDuration - directAvgDuration;
  const percentDiff = directAvgDuration > 0 ? ((diff / directAvgDuration) * 100).toFixed(1) : 0;
  const trimmedDiff = lbTrimmedAvg - directTrimmedAvg;
  const trimmedPercentDiff =
    directTrimmedAvg > 0 ? ((trimmedDiff / directTrimmedAvg) * 100).toFixed(1) : 0;
  const fasterOrSlower = diff < 0 ? '快' : '慢';
  const trimmedFasterOrSlower = trimmedDiff < 0 ? '快' : '慢';

  console.log(`  全量平均:`);
  console.log(`    LB 平均耗时:     ${lbAvgDuration}ms`);
  console.log(`    Direct 平均耗时: ${directAvgDuration}ms`);
  console.log(`    差异:            LB ${fasterOrSlower} ${Math.abs(diff)}ms (${percentDiff}%)`);
  console.log(`  剔除首尾后平均:`);
  console.log(`    LB 平均耗时:     ${lbTrimmedAvg}ms`);
  console.log(`    Direct 平均耗时: ${directTrimmedAvg}ms`);
  console.log(
    `    差异:            LB ${trimmedFasterOrSlower} ${Math.abs(trimmedDiff)}ms (${trimmedPercentDiff}%)`
  );
  console.log('============================================================');

  // Return report data for saving
  return {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    lb: {
      successCount: lbResult.successCount,
      totalIterations: CONFIG.iterations,
      ttfb: lbTtfbStats,
      duration: lbDurationStats,
      rawResults: lbResult.results,
    },
    direct: {
      successCount: directResult.successCount,
      totalIterations: CONFIG.iterations,
      ttfb: directTtfbStats,
      duration: directDurationStats,
      rawResults: directResult.results,
    },
    comparison: {
      lbAvgDuration,
      directAvgDuration,
      diff,
      percentDiff: parseFloat(percentDiff),
      fasterOrSlower,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let lbProfile = null;
  let directProfile = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lb-profile' && args[i + 1]) {
      lbProfile = args[i + 1];
      i++;
    } else if (args[i] === '--direct-profile' && args[i + 1]) {
      directProfile = args[i + 1];
      i++;
    }
  }

  if (!lbProfile || !directProfile) {
    console.error(
      'Usage: node scripts/benchmark-lb-vs-direct.mjs --lb-profile <name> --direct-profile <name>'
    );
    console.error('');
    console.error('Example:');
    console.error(
      '  node scripts/benchmark-lb-vs-direct.mjs --lb-profile lb-qwen --direct-profile direct-qwen'
    );
    process.exit(1);
  }

  // Check if opencode is available
  console.log('Checking prerequisites...');
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('opencode', ['--version'], { cwd: process.cwd(), shell: true });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`opencode exited with code ${code}`));
      });
    });
    console.log('  opencode: OK');
  } catch (err) {
    console.error('Error: opencode is not available on PATH');
    process.exit(1);
  }

  // Check if oos is available
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('oos', ['--version'], { cwd: process.cwd(), shell: true });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`oos exited with code ${code}`));
      });
    });
    console.log('  oos: OK');
  } catch (err) {
    console.error('Error: oos is not available on PATH');
    process.exit(1);
  }

  // Create evidence directory
  const evidenceDir = path.resolve(CONFIG.evidenceDir);
  await fs.mkdir(evidenceDir, { recursive: true });
  console.log(`  Evidence directory: ${evidenceDir}`);

  // Save original profile
  const originalProfile = await getCurrentProfile();
  console.log(`  Current profile: ${originalProfile || 'unknown'}`);

  // Track all child processes for cleanup
  const childProcesses = [];

  // Set up cleanup handlers
  const cleanup = async () => {
    console.log('\nCleaning up...');
    if (originalProfile) {
      try {
        await switchProfile(originalProfile);
        console.log(`Restored profile: ${originalProfile}`);
      } catch (err) {
        console.error(`Failed to restore profile: ${err.message}`);
      }
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });

  // Set total timeout
  const totalTimeout = setTimeout(
    () => {
      console.error('Total timeout exceeded (10 minutes)');
      cleanup().then(() => process.exit(1));
    },
    10 * 60 * 1000
  );

  try {
    // Run LB test
    const lbResult = await runTest('LB', lbProfile, evidenceDir);

    // Run Direct test
    const directResult = await runTest('Direct', directProfile, evidenceDir);

    // Generate and save report
    const report = generateReport(lbResult, directResult, evidenceDir);
    const reportFile = path.join(evidenceDir, 'report.json');
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to: ${reportFile}`);
  } finally {
    clearTimeout(totalTimeout);
    await cleanup();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
