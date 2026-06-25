const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const previousEnhanceMiddleware = config.server?.enhanceMiddleware;

const PROJECT_ROOT = __dirname;

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(data));
}

function readBody(request, maxBytes = 20_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        request.destroy();
        reject(new Error('Request body is too large.'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function git(args) {
  return run('git', args, { cwd: PROJECT_ROOT });
}

async function runTmux(args) {
  const { code, stderr } = await run('tmux', args, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (code !== 0) throw new Error(stderr.trim() || `tmux exited with ${code}`);
}

function agentTarget() {
  const session = process.env.SLOUCH_SESSION || 'slouch-demo';
  const windowName = process.env.SLOUCH_AGENT_WINDOW || 'claude';
  return `${session}:${windowName}`;
}

async function sendPrompt(prompt) {
  const target = agentTarget();
  // Type the prompt literally (-l) so words like "Enter"/"Space" aren't parsed as
  // tmux key names, then submit with a separate Enter keystroke.
  await runTmux(['send-keys', '-t', target, '-l', prompt]);
  await runTmux(['send-keys', '-t', target, 'Enter']);
  return target;
}

// Mirror the agent's terminal output back to the phone — last `lines` of scrollback
// from the agent's tmux pane, so you can read what it's doing without a terminal.
async function captureAgentPane(lines = 200) {
  const { code, stdout } = await run('tmux', [
    'capture-pane', '-t', agentTarget(), '-p', '-S', `-${lines}`,
  ]);
  if (code !== 0) {
    return '(agent window not found — is the tmux session running?)';
  }
  return stdout;
}

// ---- Transcription (dictation) -------------------------------------------

async function transcribe(audioPath) {
  const custom = process.env.SLOUCH_TRANSCRIBE_CMD;
  if (custom) {
    const { code, stdout, stderr } = await run('sh', ['-c', custom], {
      env: { ...process.env, SLOUCH_AUDIO: audioPath },
    });
    if (code !== 0) {
      throw new Error(stderr.trim() || `transcribe command exited with ${code}`);
    }
    return stdout.trim();
  }

  // Use SLOUCH_WHISPER_MODEL if set, else auto-discover the default download path
  // so dictation works after a plain `expo start` with no env var to manage.
  const defaultModel = path.join(os.homedir(), '.cache/whisper/ggml-base.en.bin');
  const model =
    process.env.SLOUCH_WHISPER_MODEL ||
    (fs.existsSync(defaultModel) ? defaultModel : '');
  if (!model) {
    throw new Error(
      'Dictation needs setup: set SLOUCH_WHISPER_MODEL to a whisper.cpp model path ' +
        '(after `brew install whisper-cpp ffmpeg`), or set SLOUCH_TRANSCRIBE_CMD.',
    );
  }

  const wavPath = audioPath.replace(/\.[^.]+$/, '') + '.wav';
  const ff = await run('ffmpeg', [
    '-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath,
  ]);
  if (ff.code !== 0) {
    throw new Error(
      'ffmpeg failed (is it installed? `brew install ffmpeg`): ' +
        ff.stderr.split('\n').filter(Boolean).slice(-2).join(' '),
    );
  }

  try {
    const w = await run('whisper-cli', ['-m', model, '-f', wavPath, '-nt', '-np']);
    if (w.code !== 0) {
      throw new Error(
        'whisper-cli failed (installed? `brew install whisper-cpp`): ' + w.stderr.trim(),
      );
    }
    return w.stdout.trim();
  } finally {
    fs.rmSync(wavPath, { force: true });
  }
}

async function handleTranscribe(request, response) {
  const raw = await readBody(request, 12_000_000);
  const body = JSON.parse(raw || '{}');
  const audioB64 = String(body.audio ?? '');
  const format = (String(body.format ?? 'm4a').replace(/[^a-z0-9]/gi, '')) || 'm4a';

  if (!audioB64) {
    sendJson(response, 400, { ok: false, error: 'No audio provided.' });
    return;
  }

  const audioPath = path.join(os.tmpdir(), `slouch-${Date.now()}.${format}`);
  fs.writeFileSync(audioPath, Buffer.from(audioB64, 'base64'));

  try {
    const text = await transcribe(audioPath);
    sendJson(response, 200, { ok: true, text });
  } finally {
    fs.rmSync(audioPath, { force: true });
  }
}

// ---- Git ------------------------------------------------------------------

async function gitStatus() {
  const branchRes = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRes.code === 0 ? branchRes.stdout.trim() : '(unknown)';
  // Scope to the project dir (`-- .`) so a demo nested in a bigger repo only shows
  // its own changes, not the whole monorepo. For a standalone project, `.` is root.
  const statusRes = await git(['status', '--porcelain', '--', '.']);
  const files = statusRes.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) }));
  return { branch, files };
}

async function gitDiff() {
  const res = await git(['diff', 'HEAD', '--', '.']);
  let diff = res.stdout;
  if (diff.length > 60_000) diff = diff.slice(0, 60_000) + '\n… (truncated)';
  return diff || '(no changes vs last commit)';
}

async function gitBranches() {
  const res = await git(['branch', '--format=%(refname:short)']);
  const branches = res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const cur = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return { current: cur.stdout.trim(), branches };
}

async function gitCommit(message) {
  // Stage only the project subtree (`-- .`), so we don't sweep up unrelated changes
  // elsewhere in an enclosing repo.
  const add = await git(['add', '-A', '--', '.']);
  if (add.code !== 0) throw new Error(add.stderr.trim() || 'git add failed');
  const commit = await git(['commit', '-m', message]);
  if (commit.code !== 0) {
    throw new Error(commit.stderr.trim() || commit.stdout.trim() || 'Nothing to commit?');
  }
  return commit.stdout.trim();
}

async function gitPush() {
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const args = upstream.code === 0
    ? ['push']
    : ['push', '-u', 'origin', (await gitStatus()).branch];
  const res = await git(args);
  if (res.code !== 0) throw new Error(res.stderr.trim() || res.stdout.trim() || 'git push failed');
  return res.stdout.trim() || res.stderr.trim() || 'Pushed.';
}

async function gitSwitch(name, create) {
  const res = await git(create ? ['switch', '-c', name] : ['switch', name]);
  if (res.code !== 0) throw new Error(res.stderr.trim() || 'git switch failed');
  return res.stdout.trim() || `Switched to ${name}`;
}

// ---- Routing --------------------------------------------------------------

async function handleSlouch(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/slouch/health') {
    sendJson(response, 200, { ok: true, target: agentTarget() });
    return;
  }

  if (request.method === 'GET' && pathname === '/slouch/output') {
    sendJson(response, 200, { ok: true, text: await captureAgentPane() });
    return;
  }

  if (request.method === 'POST' && pathname === '/slouch/prompt') {
    const body = JSON.parse((await readBody(request)) || '{}');
    const prompt = String(body.prompt ?? '').trim();
    if (!prompt) {
      sendJson(response, 400, { ok: false, error: 'Prompt is required.' });
      return;
    }
    const target = await sendPrompt(prompt);
    sendJson(response, 200, { ok: true, target });
    return;
  }

  if (request.method === 'POST' && pathname === '/slouch/transcribe') {
    await handleTranscribe(request, response);
    return;
  }

  if (request.method === 'GET' && pathname === '/slouch/git/status') {
    sendJson(response, 200, { ok: true, ...(await gitStatus()) });
    return;
  }

  if (request.method === 'GET' && pathname === '/slouch/git/diff') {
    sendJson(response, 200, { ok: true, diff: await gitDiff() });
    return;
  }

  if (request.method === 'GET' && pathname === '/slouch/git/branches') {
    sendJson(response, 200, { ok: true, ...(await gitBranches()) });
    return;
  }

  if (request.method === 'POST' && pathname === '/slouch/git/commit') {
    const body = JSON.parse((await readBody(request)) || '{}');
    const message = String(body.message ?? '').trim();
    if (!message) {
      sendJson(response, 400, { ok: false, error: 'Commit message required.' });
      return;
    }
    sendJson(response, 200, { ok: true, result: await gitCommit(message) });
    return;
  }

  if (request.method === 'POST' && pathname === '/slouch/git/push') {
    sendJson(response, 200, { ok: true, result: await gitPush() });
    return;
  }

  if (request.method === 'POST' && pathname === '/slouch/git/switch') {
    const body = JSON.parse((await readBody(request)) || '{}');
    const name = String(body.name ?? '').trim();
    if (!name) {
      sendJson(response, 400, { ok: false, error: 'Branch name required.' });
      return;
    }
    sendJson(response, 200, { ok: true, result: await gitSwitch(name, !!body.create) });
    return;
  }

  sendJson(response, 404, { ok: false, error: 'Not found' });
}

config.server = {
  ...config.server,
  enhanceMiddleware(middleware, server) {
    const enhancedMiddleware = previousEnhanceMiddleware
      ? previousEnhanceMiddleware(middleware, server)
      : middleware;

    return async (request, response, next) => {
      if (!request.url?.startsWith('/slouch/')) {
        return enhancedMiddleware(request, response, next);
      }

      if (request.method === 'OPTIONS') {
        sendJson(response, 204, {});
        return;
      }

      const pathname = new URL(request.url, 'http://localhost').pathname;

      try {
        await handleSlouch(request, response, pathname);
      } catch (error) {
        sendJson(response, 500, {
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown Metro bridge error',
        });
      }
    };
  },
};

module.exports = config;
