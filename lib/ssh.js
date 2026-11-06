/**
 * SSH transport for the G1 robot.
 *
 * Uses the system OpenSSH client (`ssh`) with password authentication supplied
 * through a one-shot `SSH_ASKPASS` helper, so no `sshpass` dependency is
 * required and the password never appears on a command line. Commands run in
 * the remote login shell; file helpers stream content over the same channel.
 */
import { spawn } from 'node:child_process'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const DEFAULT_STATE_DIR = join(homedir(), '.dsh', 'g1-ssh')

/**
 * Read a Config value. Schemastery exposes `volatile()` fields as live
 * references, so unwrap those to their current value on every read.
 */
function unwrap(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

/** Read a non-empty trimmed string, or fall back. */
function text(value, fallback) {
  const current = unwrap(value)
  return typeof current === 'string' && current.trim() !== '' ? current.trim() : fallback
}

/** Read a positive integer within bounds, or fall back. */
function integer(value, fallback, min, max) {
  const current = unwrap(value)
  const parsed = typeof current === 'number' ? current : Number.parseInt(String(current ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  const rounded = Math.trunc(parsed)
  if (rounded < min || rounded > max) return fallback
  return rounded
}

/** Expand a leading `~` so config values can be written like shell paths. */
function expandHome(value) {
  const current = unwrap(value)
  if (typeof current !== 'string') return ''
  if (current === '~') return homedir()
  if (current.startsWith('~/')) return join(homedir(), current.slice(2))
  return current
}

/** Quote one value for a POSIX shell command line. */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

/**
 * Normalize a plugin row config into the resolved connection settings.
 * @param {Record<string, unknown>} [raw] - the loader row config.
 */
export function resolveConfig(raw = {}) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const read = (key) => unwrap(source[key])
  const stateDir = expandHome(read('stateDir')) || DEFAULT_STATE_DIR
  const password = read('password')
  const mode = read('mode')
  return {
    mode: mode === 'wired' ? 'wired' : 'wifi',
    setupDone: read('setupDone') === true,
    host: text(read('host'), '192.168.10.183'),
    port: integer(read('port'), 22, 1, 65535),
    user: text(read('user'), 'unitree'),
    password: typeof password === 'string' ? password : '',
    privateKeyPath: text(read('privateKeyPath'), '') === '' ? '' : expandHome(read('privateKeyPath')),
    connectTimeoutSec: integer(read('connectTimeoutSec'), 10, 1, 120),
    commandTimeoutSec: integer(read('commandTimeoutSec'), 60, 1, 3600),
    stateDir,
    knownHostsFile: expandHome(read('knownHostsFile')) || join(stateDir, 'known_hosts'),
    maxOutputChars: integer(read('maxOutputChars'), 60000, 1000, 4_000_000),
  }
}

/** One-line target description used in messages. */
export function describeTarget(config) {
  return `${config.user}@${config.host}:${config.port}`
}

/** Build the shared ssh option list. */
function sshOptions(config) {
  const options = [
    '-F', '/dev/null',
    '-p', String(config.port),
    '-o', `ConnectTimeout=${config.connectTimeoutSec}`,
    '-o', 'ConnectionAttempts=1',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=2',
    '-o', 'LogLevel=ERROR',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${config.knownHostsFile}`,
    '-o', 'GlobalKnownHostsFile=/dev/null',
  ]
  if (config.privateKeyPath !== '') {
    options.push('-o', 'PubkeyAuthentication=yes', '-o', 'IdentitiesOnly=yes', '-i', config.privateKeyPath)
  } else {
    options.push(
      '-o', 'PubkeyAuthentication=no',
      '-o', 'PreferredAuthentications=password,keyboard-interactive',
      '-o', 'NumberOfPasswordPrompts=1',
    )
  }
  return options
}

/** Write a short-lived askpass helper that echoes the configured password. */
async function createAskpass(config) {
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 })
  const file = join(config.stateDir, `askpass-${process.pid}-${randomBytes(4).toString('hex')}.sh`)
  const encoded = Buffer.from(`${config.password}\n`, 'utf8').toString('base64')
  await writeFile(file, `#!/bin/sh\nprintf '%s' '${encoded}' | base64 -d\n`, { mode: 0o700 })
  await chmod(file, 0o700)
  return file
}

/** Spawn one ssh invocation and collect its output. */
function spawnSsh(config, command, { askpass, input, timeoutMs, signal, maxOutputChars }) {
  return new Promise((resolve, reject) => {
    const args = [...sshOptions(config), `${config.user}@${config.host}`]
    if (command !== undefined && command !== '') args.push(command)

    const env = { ...process.env }
    if (askpass !== undefined) {
      env.SSH_ASKPASS = askpass
      env.SSH_ASKPASS_REQUIRE = 'force'
      if (env.DISPLAY === undefined || env.DISPLAY === '') env.DISPLAY = ':0'
    }

    let child
    try {
      child = spawn('ssh', args, {
        env,
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(error)
      return
    }

    const startedAt = Date.now()
    const cap = maxOutputChars
    const stdoutChunks = []
    const stderrChunks = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    let timedOut = false
    let aborted = false
    let settled = false

    const onAbort = () => {
      aborted = true
      child.kill('SIGKILL')
    }

    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)
      : undefined

    if (signal !== undefined) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
    }

    child.stdout.on('data', (chunk) => {
      if (stdoutBytes < cap) {
        const room = cap - stdoutBytes
        const piece = chunk.length <= room ? chunk : chunk.subarray(0, room)
        stdoutChunks.push(piece)
        stdoutBytes += piece.length
        if (piece.length < chunk.length) truncated = true
      } else {
        truncated = true
      }
    })
    child.stderr.on('data', (chunk) => {
      if (stderrBytes < cap) {
        const room = cap - stderrBytes
        const piece = chunk.length <= room ? chunk : chunk.subarray(0, room)
        stderrChunks.push(piece)
        stderrBytes += piece.length
        if (piece.length < chunk.length) truncated = true
      } else {
        truncated = true
      }
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })

    if (input !== undefined) {
      // A remote-side failure can close the channel before stdin drains.
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    }

    child.on('close', (code, exitSignal) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({
        code: code ?? -1,
        signal: exitSignal ?? null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs: Date.now() - startedAt,
        timedOut,
        aborted,
        truncated,
      })
    })
  })
}

/**
 * Run one command on the robot.
 * @param {ReturnType<typeof resolveConfig>} config - resolved connection settings.
 * @param {string} command - shell command executed by the remote login shell.
 * @param {{ input?: string | Buffer, timeoutMs?: number, signal?: AbortSignal, maxOutputChars?: number }} [options]
 */
export async function runRemote(config, command, options = {}) {
  if (config.privateKeyPath === '' && config.password === '') {
    throw new Error(`G1 SSH 尚未配置登录凭据：请在插件配置中设置 password 或 privateKeyPath（目标 ${describeTarget(config)}）。`)
  }
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 })
  const askpass = config.privateKeyPath === '' ? await createAskpass(config) : undefined
  try {
    const timeoutMs = options.timeoutMs ?? config.commandTimeoutSec * 1000
    return await spawnSsh(config, command, {
      askpass,
      input: options.input,
      timeoutMs,
      signal: options.signal,
      maxOutputChars: options.maxOutputChars ?? config.maxOutputChars,
    })
  } finally {
    if (askpass !== undefined) await rm(askpass, { force: true }).catch(() => {})
  }
}

/** Recognize connection-level ssh failures (exit 255) and summarize them. */
export function connectionFailure(config, result) {
  if (result.aborted) return new Error('操作已取消。')
  if (result.timedOut) return new Error(`连接或命令超时（${describeTarget(config)}）。请确认 G1 已开机、SSH 服务运行且与本机在同一网络。`)
  if (result.code !== 255) return undefined
  const detail = result.stderr.trim().split('\n').filter((line) => line.trim() !== '').slice(-1)[0] ?? ''
  const hint = detail === '' ? 'ssh 退出码 255（连接失败）。' : detail
  return new Error(`无法通过 SSH 连接 G1（${describeTarget(config)}）：${hint} 请确认 G1 已开机并连入同一 Wi-Fi/局域网，地址与密码正确，且 sshd 已启动。`)
}

/** Throw when the ssh process itself failed to establish or keep the session. */
export function assertTransport(config, result) {
  const failure = connectionFailure(config, result)
  if (failure !== undefined) throw failure
}

/** Read a line range of a remote text file plus its total line count. */
export async function readRemoteText(config, path, options = {}) {
  const offset = integer(options.offset, 1, 1, Number.MAX_SAFE_INTEGER)
  const limit = integer(options.limit, 500, 1, 5000)
  const start = offset
  const end = start + limit - 1
  const quoted = shellQuote(path)
  const marker = '@@DSH_G1_BOUNDARY@@'
  const script = [
    `awk 'END{print NR}' ${quoted} && printf '%s\\n' ${shellQuote(marker)} && sed -n ${shellQuote(`${start},${end}p`)} ${quoted}`,
  ].join('\n')
  const result = await runRemote(config, script, { timeoutMs: Math.min(config.commandTimeoutSec * 1000, 120000), signal: options.signal })
  assertTransport(config, result)
  if (result.code !== 0) {
    throw new Error(`读取 G1 文件失败（${path}，退出码 ${result.code}）：${result.stderr.trim() || result.stdout.trim()}`)
  }
  const boundary = `${marker}\n`
  const index = result.stdout.indexOf(boundary)
  const header = index === -1 ? result.stdout : result.stdout.slice(0, index)
  const body = index === -1 ? '' : result.stdout.slice(index + boundary.length)
  const totalLines = Number.parseInt(header.trim(), 10)
  const lines = body === '' ? [] : body.replace(/\n$/, '').split('\n')
  return {
    totalLines: Number.isFinite(totalLines) ? totalLines : lines.length,
    start,
    end: start + Math.max(lines.length - 1, 0),
    lines,
    truncated: result.truncated,
  }
}

/** Write a remote text file atomically, optionally creating parents and a backup. */
export async function writeRemoteText(config, path, content, options = {}) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || '/' : '.'
  const script = ['set -e']
  if (options.createDirs === true) script.push(`mkdir -p ${shellQuote(dir)}`)
  if (options.backup === true) script.push(`if [ -f ${shellQuote(path)} ]; then cp -p ${shellQuote(path)} ${shellQuote(`${path}.bak`)}; fi`)
  script.push(`tmp=$(mktemp ${shellQuote(`${path}.tmp.XXXXXX`)})`)
  script.push(`if [ -f ${shellQuote(path)} ]; then chmod --reference=${shellQuote(path)} "$tmp" 2>/dev/null || true; else chmod 644 "$tmp"; fi`)
  script.push(`cat > "$tmp"`)
  script.push(`mv -f "$tmp" ${shellQuote(path)}`)
  script.push(`wc -c < ${shellQuote(path)}`)
  const result = await runRemote(config, script.join('\n'), {
    input: content,
    timeoutMs: Math.min(config.commandTimeoutSec * 1000, 120000),
    signal: options.signal,
  })
  assertTransport(config, result)
  if (result.code !== 0) {
    throw new Error(`写入 G1 文件失败（${path}，退出码 ${result.code}）：${result.stderr.trim()}`)
  }
  const bytes = Number.parseInt(result.stdout.trim().split('\n').pop() ?? '', 10)
  return { bytes: Number.isFinite(bytes) ? bytes : Buffer.byteLength(content), backupPath: options.backup === true ? `${path}.bak` : undefined }
}

/** Read a whole remote text file (bounded by `maxBytes`) for in-place editing. */
export async function readRemoteFileForEdit(config, path, maxBytes) {
  const sizeResult = await runRemote(config, `wc -c < ${shellQuote(path)}`, { timeoutMs: 30000 })
  assertTransport(config, sizeResult)
  if (sizeResult.code !== 0) {
    throw new Error(`读取 G1 文件失败（${path}）：${sizeResult.stderr.trim()}`)
  }
  const size = Number.parseInt(sizeResult.stdout.trim(), 10)
  if (Number.isFinite(size) && size > maxBytes) {
    throw new Error(`文件过大（${path}，${size} 字节 > ${maxBytes} 字节），请改用 g1_exec（如 sed/python）分段修改。`)
  }
  const readResult = await runRemote(config, `cat -- ${shellQuote(path)}`, { timeoutMs: 60000, maxOutputChars: maxBytes + 1024 })
  assertTransport(config, readResult)
  if (readResult.code !== 0) {
    throw new Error(`读取 G1 文件失败（${path}）：${readResult.stderr.trim()}`)
  }
  if (readResult.truncated) {
    throw new Error(`文件读取被截断（${path}），请改用 g1_exec（如 sed/python）分段修改。`)
  }
  return readResult.stdout
}
