#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

// --- Configuration ---

const JENKINS_URL = process.env.JENKINS_URL || 'https://jenkins.devops.asu.edu';
const JENKINS_USER = process.env.JENKINS_USER;
const JENKINS_TOKEN = process.env.JENKINS_TOKEN;
const CLOUDFLARED_APP_URL = process.env.CLOUDFLARED_APP_URL || JENKINS_URL;
const ARTIFACTS_DIR =
  process.env.JENKINS_ARTIFACTS_DIR ||
  join(process.env.HOME || '/tmp', '.kiro', 'jenkins-mcp-server', 'artifacts');

if (!JENKINS_USER || !JENKINS_TOKEN) {
  console.error(
    'JENKINS_USER and JENKINS_TOKEN environment variables are required.',
  );
  process.exit(1);
}

// --- Cloudflare Access Token ---

function getCfAccessToken() {
  try {
    const token = execSync(
      `cloudflared access token -app=${CLOUDFLARED_APP_URL}`,
      { encoding: 'utf-8', timeout: 10000 },
    ).trim();
    return token;
  } catch (err) {
    throw new Error(
      `Failed to get Cloudflare Access token. Run "cloudflared access login ${CLOUDFLARED_APP_URL}" first.\n${err.message}`,
    );
  }
}

// --- Jenkins API Client ---

async function jenkinsRequest(path, options = {}) {
  const cfToken = getCfAccessToken();
  const url = `${JENKINS_URL}${path}`;
  const basicAuth = Buffer.from(`${JENKINS_USER}:${JENKINS_TOKEN}`).toString(
    'base64',
  );

  const response = await fetch(url, {
    ...options,
    headers: {
      'cf-access-token': cfToken,
      Authorization: `Basic ${basicAuth}`,
      ...options.headers,
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Jenkins API error ${response.status}: ${response.statusText}\n${body.slice(0, 500)}`,
    );
  }

  return response;
}

async function jenkinsJson(path, options = {}) {
  const response = await jenkinsRequest(path, options);
  return response.json();
}

async function jenkinsText(path, options = {}) {
  const response = await jenkinsRequest(path, options);
  return response.text();
}

async function jenkinsBuffer(path, options = {}) {
  const response = await jenkinsRequest(path, options);
  return Buffer.from(await response.arrayBuffer());
}

function encodeJobPath(jobPath) {
  return jobPath
    .split('/')
    .map((p) => `job/${encodeURIComponent(p)}`)
    .join('/');
}

// --- MCP Server Setup ---

const server = new McpServer({
  name: 'jenkins',
  version: '1.0.0',
});

// --- Tools ---

server.tool(
  'get_build',
  'Get information about a specific Jenkins build',
  {
    jobPath: z
      .string()
      .describe('Full job path, e.g. "EADV/eadv-program-architecture-tool/aat"'),
    buildNumber: z
      .number()
      .optional()
      .describe('Build number (defaults to lastBuild)'),
  },
  async ({ jobPath, buildNumber }) => {
    const buildRef = buildNumber || 'lastBuild';
    const encodedPath = encodeJobPath(jobPath);
    const data = await jenkinsJson(`/${encodedPath}/${buildRef}/api/json`);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  },
);

server.tool(
  'get_build_log',
  'Get console output for a Jenkins build',
  {
    jobPath: z
      .string()
      .describe('Full job path, e.g. "EADV/eadv-program-architecture-tool/aat"'),
    buildNumber: z
      .number()
      .optional()
      .describe('Build number (defaults to lastBuild)'),
    startLine: z
      .number()
      .optional()
      .describe('Starting line offset (for pagination)'),
  },
  async ({ jobPath, buildNumber, startLine }) => {
    const buildRef = buildNumber || 'lastBuild';
    const encodedPath = encodeJobPath(jobPath);
    const start = startLine || 0;
    const text = await jenkinsText(
      `/${encodedPath}/${buildRef}/logText/progressiveText?start=${start}`,
    );
    return { content: [{ type: 'text', text }] };
  },
);

server.tool(
  'get_job',
  'Get information about a Jenkins job (including recent builds list)',
  {
    jobPath: z
      .string()
      .describe('Full job path, e.g. "EADV/eadv-program-architecture-tool/aat"'),
  },
  async ({ jobPath }) => {
    const encodedPath = encodeJobPath(jobPath);
    const data = await jenkinsJson(`/${encodedPath}/api/json`);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  },
);

server.tool(
  'list_builds',
  'List recent builds for a Jenkins job',
  {
    jobPath: z
      .string()
      .describe('Full job path, e.g. "EADV/eadv-program-architecture-tool/aat"'),
    limit: z.number().optional().describe('Number of builds to return (default 10)'),
  },
  async ({ jobPath, limit }) => {
    const max = limit || 10;
    const encodedPath = encodeJobPath(jobPath);
    const data = await jenkinsJson(
      `/${encodedPath}/api/json?tree=builds[number,result,timestamp,duration,displayName,url]{0,${max}}`,
    );
    return {
      content: [
        { type: 'text', text: JSON.stringify(data.builds || data, null, 2) },
      ],
    };
  },
);

server.tool(
  'get_test_results',
  'Get test results for a Jenkins build',
  {
    jobPath: z
      .string()
      .describe('Full job path, e.g. "EADV/eadv-program-architecture-tool/aat"'),
    buildNumber: z
      .number()
      .optional()
      .describe('Build number (defaults to lastBuild)'),
  },
  async ({ jobPath, buildNumber }) => {
    const buildRef = buildNumber || 'lastBuild';
    const encodedPath = encodeJobPath(jobPath);
    const data = await jenkinsJson(
      `/${encodedPath}/${buildRef}/testReport/api/json`,
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  },
);

server.tool(
  'get_artifact',
  'Read a text-based build artifact inline (e.g. error-context.md, junit.xml, .last-run.json)',
  {
    jobPath: z
      .string()
      .describe('Full job path, e.g. "EADV/eadv-program-architecture-tool/aat"'),
    buildNumber: z
      .number()
      .optional()
      .describe('Build number (defaults to lastBuild)'),
    artifactPath: z
      .string()
      .describe(
        'Relative path to the artifact, e.g. "playwright/test-results/junit.xml"',
      ),
  },
  async ({ jobPath, buildNumber, artifactPath }) => {
    const buildRef = buildNumber || 'lastBuild';
    const encodedPath = encodeJobPath(jobPath);
    const text = await jenkinsText(
      `/${encodedPath}/${buildRef}/artifact/${artifactPath}`,
    );
    return { content: [{ type: 'text', text }] };
  },
);

server.tool(
  'download_test_results',
  'Download playwright test-results and/or playwright-report artifacts to a local temp directory. Replaces previous downloads unless comparison mode is used.',
  {
    jobPath: z
      .string()
      .describe('Full job path, e.g. "EADV/eadv-program-architecture-tool/aat"'),
    buildNumber: z
      .number()
      .optional()
      .describe('Build number (defaults to lastBuild)'),
    include: z
      .enum(['all', 'test-results', 'playwright-report'])
      .optional()
      .describe('Which artifacts to download (default: all)'),
    keepPrevious: z
      .boolean()
      .optional()
      .describe(
        'If true, keeps previous download in a numbered subdirectory for comparison',
      ),
  },
  async ({ jobPath, buildNumber, include, keepPrevious }) => {
    const buildRef = buildNumber || 'lastBuild';
    const encodedPath = encodeJobPath(jobPath);
    const filter = include || 'all';

    // Get artifact list from the build
    const buildData = await jenkinsJson(
      `/${encodedPath}/${buildRef}/api/json?tree=artifacts[relativePath,fileName],number`,
    );
    const actualBuildNumber = buildData.number;
    const artifacts = buildData.artifacts || [];

    // Filter to playwright artifacts
    const targetArtifacts = artifacts.filter((a) => {
      const path = a.relativePath;
      if (filter === 'test-results') return path.startsWith('playwright/test-results/');
      if (filter === 'playwright-report') return path.startsWith('playwright/playwright-report/');
      return (
        path.startsWith('playwright/test-results/') ||
        path.startsWith('playwright/playwright-report/')
      );
    });

    if (targetArtifacts.length === 0) {
      return {
        content: [{ type: 'text', text: 'No matching playwright artifacts found in this build.' }],
      };
    }

    // Prepare output directory
    const buildDir = join(ARTIFACTS_DIR, `build-${actualBuildNumber}`);

    if (!keepPrevious && existsSync(ARTIFACTS_DIR)) {
      rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
    }

    mkdirSync(buildDir, { recursive: true });

    // Download text-based artifacts only (skip binary like .webm, .png, .zip)
    const textExtensions = ['.md', '.json', '.xml', '.html', '.txt', '.js', '.css', '.svg'];
    const downloaded = [];
    const skippedBinary = [];

    for (const artifact of targetArtifacts) {
      const ext = artifact.fileName.slice(artifact.fileName.lastIndexOf('.'));
      if (!textExtensions.includes(ext)) {
        skippedBinary.push(artifact.relativePath);
        continue;
      }

      try {
        const content = await jenkinsText(
          `/${encodedPath}/${actualBuildNumber}/artifact/${artifact.relativePath}`,
        );
        const outPath = join(buildDir, artifact.relativePath);
        mkdirSync(join(outPath, '..'), { recursive: true });
        writeFileSync(outPath, content, 'utf-8');
        downloaded.push(artifact.relativePath);
      } catch (err) {
        skippedBinary.push(`${artifact.relativePath} (error: ${err.message.slice(0, 80)})`);
      }
    }

    const summary = [
      `Downloaded ${downloaded.length} text artifacts from build #${actualBuildNumber}`,
      `Location: ${buildDir}`,
      `Skipped ${skippedBinary.length} binary files (.webm, .png, .zip, etc.)`,
      '',
      'Downloaded files:',
      ...downloaded.map((f) => `  ${f}`),
    ].join('\n');

    return { content: [{ type: 'text', text: summary }] };
  },
);

server.tool(
  'list_stages',
  'List pipeline stages for a Jenkins build with their status and duration',
  {
    jobPath: z
      .string()
      .describe('Full job path, e.g. "EADV/eadv-program-architecture-tool/sandbox"'),
    buildNumber: z
      .number()
      .optional()
      .describe('Build number (defaults to lastBuild)'),
  },
  async ({ jobPath, buildNumber }) => {
    const buildRef = buildNumber || 'lastBuild';
    const encodedPath = encodeJobPath(jobPath);

    // Use the Workflow API to get stage info
    const data = await jenkinsJson(
      `/${encodedPath}/${buildRef}/wfapi/describe`,
    );

    const stages = (data.stages || []).map((stage) => ({
      id: stage.id,
      name: stage.name,
      status: stage.status,
      durationMillis: stage.durationMillis,
      duration: `${Math.round(stage.durationMillis / 1000)}s`,
    }));

    return {
      content: [{ type: 'text', text: JSON.stringify(stages, null, 2) }],
    };
  },
);

server.tool(
  'get_stage_log',
  'Get the console log for a specific pipeline stage',
  {
    jobPath: z
      .string()
      .describe('Full job path, e.g. "EADV/eadv-program-architecture-tool/sandbox"'),
    buildNumber: z
      .number()
      .optional()
      .describe('Build number (defaults to lastBuild)'),
    stageName: z
      .string()
      .optional()
      .describe('Stage name to get logs for (use list_stages to see available names)'),
    stageId: z
      .string()
      .optional()
      .describe('Stage ID (numeric, from list_stages). Use this OR stageName.'),
  },
  async ({ jobPath, buildNumber, stageName, stageId }) => {
    const buildRef = buildNumber || 'lastBuild';
    const encodedPath = encodeJobPath(jobPath);

    // First get the stage list to find the right node
    const data = await jenkinsJson(
      `/${encodedPath}/${buildRef}/wfapi/describe`,
    );

    let targetStage;
    if (stageId) {
      targetStage = data.stages.find((s) => s.id === stageId);
    } else if (stageName) {
      // Case-insensitive partial match
      const lower = stageName.toLowerCase();
      targetStage = data.stages.find(
        (s) => s.name.toLowerCase() === lower || s.name.toLowerCase().includes(lower),
      );
    }

    if (!targetStage) {
      const available = data.stages.map((s) => `  ${s.id}: ${s.name}`).join('\n');
      return {
        content: [
          {
            type: 'text',
            text: `Stage not found. Available stages:\n${available}`,
          },
        ],
      };
    }

    // Get the execution nodes for this stage
    const stageDetail = await jenkinsJson(
      `/${encodedPath}/${buildRef}/execution/node/${targetStage.id}/wfapi/describe`,
    );

    // Collect log text from all flow nodes in this stage
    const logParts = [];
    const nodeIds = (stageDetail.stageFlowNodes || []).map((n) => n.id);

    for (const nodeId of nodeIds) {
      try {
        const nodeLog = await jenkinsJson(
          `/${encodedPath}/${buildRef}/execution/node/${nodeId}/wfapi/log`,
        );
        if (nodeLog.text) {
          logParts.push(nodeLog.text);
        }
      } catch {
        // Some nodes don't have logs
      }
    }

    if (logParts.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No log output found for stage "${targetStage.name}" (${targetStage.status})`,
          },
        ],
      };
    }

    const header = `Stage: ${targetStage.name} | Status: ${targetStage.status} | Duration: ${Math.round(targetStage.durationMillis / 1000)}s\n${'─'.repeat(60)}\n`;
    return {
      content: [{ type: 'text', text: header + logParts.join('') }],
    };
  },
);



server.tool(
  'get_failed_tests',
  'Get only the failing/erroring test cases from a build with their error messages. Much more concise than get_test_results.',
  {
    jobPath: z
      .string()
      .describe('Full job path, e.g. "EADV/eadv-program-architecture-tool/aat"'),
    buildNumber: z
      .number()
      .optional()
      .describe('Build number (defaults to lastBuild)'),
  },
  async ({ jobPath, buildNumber }) => {
    const buildRef = buildNumber || 'lastBuild';
    const encodedPath = encodeJobPath(jobPath);
    const data = await jenkinsJson(
      `/${encodedPath}/${buildRef}/testReport/api/json`,
    );

    const failed = [];
    for (const suite of data.suites || []) {
      for (const c of suite.cases || []) {
        if (c.status === 'FAILED' || c.status === 'REGRESSION' || c.errorDetails) {
          failed.push({
            suite: suite.name,
            name: c.name,
            status: c.status,
            duration: Math.round(c.duration) + 's',
            errorMessage: c.errorDetails ? c.errorDetails.slice(0, 500) : null,
            errorStack: c.errorStackTrace ? c.errorStackTrace.slice(0, 300) : null,
          });
        }
      }
    }

    if (failed.length === 0) {
      const total = (data.passCount || 0) + (data.failCount || 0) + (data.skipCount || 0);
      return {
        content: [{ type: 'text', text: `No failed tests in build #${buildRef}. Total: ${total} tests (${data.passCount} passed, ${data.skipCount} skipped).` }],
      };
    }

    const total = (data.passCount || 0) + (data.failCount || 0) + (data.skipCount || 0);
    const summary = `${failed.length} failed test(s) out of ${total} total\n\n`;
    return {
      content: [{ type: 'text', text: summary + JSON.stringify(failed, null, 2) }],
    };
  },
);

server.tool(
  'compare_builds',
  'Compare test results between two builds to see which tests flipped (pass to fail or fail to pass).',
  {
    jobPath: z
      .string()
      .describe('Full job path, e.g. "EADV/eadv-program-architecture-tool/aat"'),
    buildA: z
      .number()
      .describe('First build number (typically the older/good build)'),
    buildB: z
      .number()
      .describe('Second build number (typically the newer/bad build)'),
  },
  async ({ jobPath, buildA, buildB }) => {
    const encodedPath = encodeJobPath(jobPath);

    const [dataA, dataB] = await Promise.all([
      jenkinsJson(`/${encodedPath}/${buildA}/testReport/api/json`),
      jenkinsJson(`/${encodedPath}/${buildB}/testReport/api/json`),
    ]);

    function buildTestMap(data) {
      const map = new Map();
      for (const suite of data.suites || []) {
        for (const c of suite.cases || []) {
          const key = `${suite.name} > ${c.name}`;
          map.set(key, {
            status: c.status,
            duration: c.duration,
            error: c.errorDetails ? c.errorDetails.slice(0, 200) : null,
          });
        }
      }
      return map;
    }

    const mapA = buildTestMap(dataA);
    const mapB = buildTestMap(dataB);

    const newFailures = [];
    const fixed = [];
    const stillFailing = [];
    const newTests = [];
    const removedTests = [];

    for (const [name, resultB] of mapB) {
      const resultA = mapA.get(name);
      const bFailed = resultB.status === 'FAILED' || resultB.status === 'REGRESSION';

      if (!resultA) {
        newTests.push({ name, status: resultB.status });
        continue;
      }

      const aFailed = resultA.status === 'FAILED' || resultA.status === 'REGRESSION';

      if (!aFailed && bFailed) {
        newFailures.push({ name, error: resultB.error });
      } else if (aFailed && !bFailed) {
        fixed.push({ name });
      } else if (aFailed && bFailed) {
        stillFailing.push({ name, error: resultB.error });
      }
    }

    for (const [name] of mapA) {
      if (!mapB.has(name)) {
        removedTests.push({ name });
      }
    }

    const lines = [
      `Comparing build #${buildA} -> #${buildB}`,
      `Build #${buildA}: ${dataA.passCount} passed, ${dataA.failCount} failed, ${dataA.skipCount} skipped`,
      `Build #${buildB}: ${dataB.passCount} passed, ${dataB.failCount} failed, ${dataB.skipCount} skipped`,
      '',
    ];

    if (newFailures.length > 0) {
      lines.push(`NEW FAILURES (${newFailures.length}):`);
      for (const t of newFailures) {
        lines.push(`  - ${t.name}`);
        if (t.error) lines.push(`    ${t.error.split('\n')[0]}`);
      }
      lines.push('');
    }

    if (fixed.length > 0) {
      lines.push(`FIXED (${fixed.length}):`);
      for (const t of fixed) {
        lines.push(`  - ${t.name}`);
      }
      lines.push('');
    }

    if (stillFailing.length > 0) {
      lines.push(`STILL FAILING (${stillFailing.length}):`);
      for (const t of stillFailing) {
        lines.push(`  - ${t.name}`);
      }
      lines.push('');
    }

    if (newTests.length > 0) {
      lines.push(`NEW TESTS (${newTests.length}):`);
      for (const t of newTests) {
        lines.push(`  - ${t.name} (${t.status})`);
      }
      lines.push('');
    }

    if (removedTests.length > 0) {
      lines.push(`REMOVED TESTS (${removedTests.length}):`);
      for (const t of removedTests) {
        lines.push(`  - ${t.name}`);
      }
    }

    if (newFailures.length === 0 && fixed.length === 0 && stillFailing.length === 0) {
      lines.push('No test status changes between builds.');
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

// --- Start Server ---

const transport = new StdioServerTransport();
await server.connect(transport);
