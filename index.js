/**
 * G1 SSH Bridge — agent tools for a Unitree G1 robot over wireless SSH.
 *
 * Tools: g1_status, g1_exec, g1_read, g1_write, g1_edit, g1_configure.
 * Connection settings live in this bundle row's Config; the browser half writes
 * them through the Harness settings service, and volatile fields update live.
 */
import z from '@deepseek-ai/schemastery'
import {
  assertTransport,
  connectionFailure,
  describeTarget,
  readRemoteFileForEdit,
  readRemoteText,
  resolveConfig,
  runRemote,
  shellQuote,
  writeRemoteText,
} from './lib/ssh.js'

export const inject = ['tools']

/**
 * Connection profile. `volatile()` fields stay editable at runtime: the Loader
 * hands the plugin live references, so the tools below read the current value
 * on every call. `password` is a secret: the browser form can write it but
 * never receives it back.
 */
export const Config = z.object({
  mode: z.string().default('wifi').volatile(),
  host: z.string().default('').volatile(),
  user: z.string().default('unitree').volatile(),
  password: z.string().role('secret').default('').volatile(),
  setupDone: z.boolean().default(false).volatile(),
  port: z.number().default(22),
  privateKeyPath: z.string().default(''),
  connectTimeoutSec: z.number().default(10),
  commandTimeoutSec: z.number().default(60),
  knownHostsFile: z.string().default(''),
  stateDir: z.string().default(''),
  maxOutputChars: z.number().default(60000),
})

const MAX_RENDER_CHARS = 32000
const MAX_EDIT_BYTES = 2_000_000

/** Trim oversized tool output, keeping the head and the tail. */
function clip(value) {
  const source = value ?? ''
  if (source.length <= MAX_RENDER_CHARS) return source
  const head = source.slice(0, Math.floor(MAX_RENDER_CHARS * 0.62))
  const tail = source.slice(-Math.floor(MAX_RENDER_CHARS * 0.33))
  const omitted = source.length - head.length - tail.length
  return `${head}\n…[输出过长，省略 ${omitted} 字符；如需完整内容，请把命令输出重定向到文件后用 g1_read 查看]…\n${tail}`
}

/** One text content block. */
function textBlock(value) {
  return [{ type: 'text', text: value }]
}

/** Parse `key=value` lines produced by the status probe. */
function parseFacts(stdout) {
  const facts = {}
  for (const line of stdout.split('\n')) {
    const index = line.indexOf('=')
    if (index > 0) facts[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return facts
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack, needle) {
  if (needle === '') return 0
  let count = 0
  let from = 0
  for (;;) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) return count
    count += 1
    from = index + needle.length
  }
}

/** Status probe script: one `key=value` line per fact, tolerant of missing tools. */
const STATUS_SCRIPT = [
  'printf \'hostname=%s\\n\' "$(hostname 2>/dev/null)"',
  'printf \'kernel=%s\\n\' "$(uname -srm 2>/dev/null)"',
  'printf \'user=%s\\n\' "$(id -un 2>/dev/null)"',
  'printf \'home=%s\\n\' "$HOME"',
  'printf \'cwd=%s\\n\' "$(pwd)"',
  'printf \'uptime_sec=%s\\n\' "$(cut -d. -f1 /proc/uptime 2>/dev/null)"',
  'printf \'mem_total_kb=%s\\n\' "$(awk \'/MemTotal/{print $2}\' /proc/meminfo 2>/dev/null)"',
  'printf \'disk_free_kb=%s\\n\' "$(df -Pk "$HOME" 2>/dev/null | awk \'NR==2{print $4}\')"',
].join('\n')

/** Locate this plugin's Loader entry id for settings writes. */
function entryIdOf(ctx) {
  try {
    const editor = ctx.get('configEditor')
    const row = editor?.entries().find((entry) => entry.options.name === 'dsh-g1-ssh')
    return row?.options.id
  } catch {
    return undefined
  }
}

/** Current connection profile without the password. */
function profileOf(config) {
  return {
    mode: config.mode,
    host: config.host,
    port: config.port,
    user: config.user,
    passwordSet: config.password !== '' || config.privateKeyPath !== '',
  }
}

/** Build the tool definitions; each call reads the live configuration. */
function buildTools(ctx, getConfig) {
  const status = {
    name: 'g1_status',
    description: 'Probe the SSH link to the Unitree G1 robot and report whether it is reachable plus basic system facts (hostname, kernel, user, uptime, memory, free disk). Call this first whenever the robot may be offline or its address may have changed.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: {
          reachable: { type: 'boolean' },
          target: { type: 'string' },
          latencyMs: { type: 'integer' },
          error: { type: 'string' },
          hostname: { type: 'string' },
          kernel: { type: 'string' },
          user: { type: 'string' },
          home: { type: 'string' },
          cwd: { type: 'string' },
          uptimeSec: { type: 'integer' },
          memTotalKb: { type: 'integer' },
          diskFreeKb: { type: 'integer' },
        },
        required: ['reachable', 'target'],
      },
      render: (_args, value) => textBlock(renderStatus(value)),
    },
    async execute(_args, exec) {
      const config = getConfig()
      const target = describeTarget(config)
      try {
        const result = await runRemote(config, STATUS_SCRIPT, { timeoutMs: Math.max(config.connectTimeoutSec * 1000 + 4000, 15000), signal: exec.signal })
        const failure = connectionFailure(config, result)
        if (failure !== undefined) {
          return { reachable: false, target, error: failure.message }
        }
        const facts = parseFacts(result.stdout)
        const value = { reachable: true, target, latencyMs: result.durationMs }
        if (facts.hostname) value.hostname = facts.hostname
        if (facts.kernel) value.kernel = facts.kernel
        if (facts.user) value.user = facts.user
        if (facts.home) value.home = facts.home
        if (facts.cwd) value.cwd = facts.cwd
        const uptime = Number.parseInt(facts.uptime_sec ?? '', 10)
        if (Number.isFinite(uptime)) value.uptimeSec = uptime
        const memory = Number.parseInt(facts.mem_total_kb ?? '', 10)
        if (Number.isFinite(memory)) value.memTotalKb = memory
        const disk = Number.parseInt(facts.disk_free_kb ?? '', 10)
        if (Number.isFinite(disk)) value.diskFreeKb = disk
        if (result.code !== 0) value.error = `状态探测命令退出码 ${result.code}：${result.stderr.trim() || result.stdout.trim()}`
        return value
      } catch (error) {
        return { reachable: false, target, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }

  const execTool = {
    name: 'g1_exec',
    description: 'Run a shell command on the Unitree G1 robot over SSH and return its exit code, stdout, and stderr. The command runs in the robot\'s login shell as the configured user with full filesystem access, so it can inspect or modify the robot\'s programs (systemctl, ps, python3, ls, cat, ...). Each call is an independent shell; use absolute paths or `cwd`. Remote commands time out after 60 seconds by default (max 600).',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute on the robot, for example `ls -la ~` or `systemctl is-active unitree_sport`.' },
        cwd: { type: 'string', description: 'Remote working directory; omit to use the login home directory.' },
        timeout_sec: { type: 'integer', description: 'Command timeout in seconds, 1-600; defaults to 60.' },
      },
      required: ['command'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          exitCode: { type: 'integer' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          durationMs: { type: 'integer' },
          timedOut: { type: 'boolean' },
          truncated: { type: 'boolean' },
        },
        required: ['ok', 'exitCode', 'stdout', 'stderr', 'durationMs', 'timedOut', 'truncated'],
      },
      render: (_args, value) => textBlock(renderExec(value)),
    },
    async execute(args, exec) {
      const config = getConfig()
      const command = typeof args.command === 'string' ? args.command : ''
      if (command.trim() === '') throw new Error('command 不能为空。')
      const timeoutSec = clampInteger(args.timeout_sec, 60, 1, 600)
      const cwd = typeof args.cwd === 'string' && args.cwd.trim() !== '' ? args.cwd.trim() : ''
      const script = cwd === '' ? command : `cd ${shellQuote(cwd)} && (\n${command}\n)`
      const result = await runRemote(config, script, { timeoutMs: timeoutSec * 1000, signal: exec.signal })
      assertTransport(config, result)
      return {
        ok: result.code === 0,
        exitCode: result.code,
        stdout: clip(result.stdout),
        stderr: clip(result.stderr),
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        truncated: result.truncated,
      }
    },
  }

  const read = {
    name: 'g1_read',
    description: 'Read a UTF-8 text file on the G1 robot with line numbers, optionally one line range (offset starting at 1, limit up to 5000). Use it before g1_edit so the exact old_string can be copied. Large files are trimmed; use g1_exec with sed/head for deeper inspection.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path on the robot, e.g. /home/unitree/app/config.yaml.' },
        offset: { type: 'integer', description: 'First line to return, 1-based; defaults to 1.' },
        limit: { type: 'integer', description: 'Maximum number of lines, 1-5000; defaults to 500.' },
      },
      required: ['path'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          totalLines: { type: 'integer' },
          start: { type: 'integer' },
          end: { type: 'integer' },
          lines: { type: 'array', items: { type: 'string' } },
          truncated: { type: 'boolean' },
        },
        required: ['path', 'totalLines', 'start', 'end', 'lines', 'truncated'],
      },
      render: (_args, value) => textBlock(renderRead(value)),
    },
    async execute(args, exec) {
      const config = getConfig()
      const path = requirePath(args.path)
      const result = await readRemoteText(config, path, {
        offset: args.offset,
        limit: args.limit,
        signal: exec.signal,
      })
      return { path, ...result }
    },
  }

  const write = {
    name: 'g1_write',
    description: 'Create or overwrite a UTF-8 text file on the G1 robot. The write is atomic (temporary file plus rename) and preserves the existing file mode. Set create_dirs to create missing parent directories, and backup to keep the previous content at <path>.bak.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute target path on the robot.' },
        content: { type: 'string', description: 'Complete new file content.' },
        create_dirs: { type: 'boolean', description: 'Create missing parent directories; defaults to false.' },
        backup: { type: 'boolean', description: 'Copy the previous file to <path>.bak first; defaults to false.' },
      },
      required: ['path', 'content'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          bytes: { type: 'integer' },
          backupPath: { type: 'string' },
        },
        required: ['path', 'bytes'],
      },
      render: (_args, value) => textBlock(`已写入 ${value.path}（${value.bytes} 字节）${value.backupPath ? `，备份：${value.backupPath}` : ''}`),
    },
    async execute(args, exec) {
      const config = getConfig()
      const path = requirePath(args.path)
      const content = typeof args.content === 'string' ? args.content : ''
      const result = await writeRemoteText(config, path, content, {
        createDirs: args.create_dirs === true,
        backup: args.backup === true,
        signal: exec.signal,
      })
      const value = { path, bytes: result.bytes }
      if (result.backupPath !== undefined) value.backupPath = result.backupPath
      return value
    },
  }

  const edit = {
    name: 'g1_edit',
    description: 'Replace exact text in a file on the G1 robot. old_string must match exactly and must be unique unless replace_all is true. Prefer this over g1_write when changing part of a large program file. Files are limited to 2 MB; use g1_exec with sed/python for larger files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of the file on the robot.' },
        old_string: { type: 'string', description: 'Exact text to replace, including indentation and line breaks.' },
        new_string: { type: 'string', description: 'Replacement text; may be empty to delete.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence; defaults to false (a non-unique old_string then fails).' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          replacements: { type: 'integer' },
          bytesBefore: { type: 'integer' },
          bytesAfter: { type: 'integer' },
        },
        required: ['path', 'replacements', 'bytesBefore', 'bytesAfter'],
      },
      render: (_args, value) => textBlock(`已修改 ${value.path}：替换 ${value.replacements} 处（${value.bytesBefore} → ${value.bytesAfter} 字节）`),
    },
    async execute(args, exec) {
      const config = getConfig()
      const path = requirePath(args.path)
      const oldString = typeof args.old_string === 'string' ? args.old_string : ''
      if (oldString === '') throw new Error('old_string 不能为空；要覆盖整个文件请使用 g1_write。')
      const newString = typeof args.new_string === 'string' ? args.new_string : ''
      const content = await readRemoteFileForEdit(config, path, MAX_EDIT_BYTES)
      const occurrences = countOccurrences(content, oldString)
      if (occurrences === 0) throw new Error(`old_string 在 ${path} 中未找到（注意缩进、换行与空白必须完全一致）。`)
      if (occurrences > 1 && args.replace_all !== true) {
        throw new Error(`old_string 在 ${path} 中出现 ${occurrences} 次，不唯一：请补充上下文，或设置 replace_all=true。`)
      }
      const updated = content.split(oldString).join(newString)
      exec.signal.throwIfAborted()
      const written = await writeRemoteText(config, path, updated, { signal: exec.signal })
      return {
        path,
        replacements: args.replace_all === true ? occurrences : 1,
        bytesBefore: Buffer.byteLength(content, 'utf8'),
        bytesAfter: written.bytes,
      }
    },
  }

  const configure = {
    name: 'g1_configure',
    description: 'Read or update the G1 SSH connection profile owned by this plugin: connection mode (wifi or wired), host address, SSH user, and password. Settings written here are exactly the ones the G1 settings page edits, so the robot address can be fixed from a conversation. The password is never returned; `passwordSet` only reports whether one is stored.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set'], description: '`get` reads the current profile; `set` writes the supplied fields.' },
        mode: { type: 'string', enum: ['wifi', 'wired'], description: 'Connection mode to store.' },
        host: { type: 'string', description: 'Robot IPv4 address or hostname.' },
        user: { type: 'string', description: 'SSH login user, normally `unitree`.' },
        password: { type: 'string', description: 'SSH password; omit to keep the stored one.' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          host: { type: 'string' },
          port: { type: 'integer' },
          user: { type: 'string' },
          passwordSet: { type: 'boolean' },
        },
        required: ['mode', 'host', 'port', 'user', 'passwordSet'],
      },
      render: (_args, value) => textBlock(renderProfile(value)),
    },
    async execute(args, exec) {
      if (args.action === 'get') return profileOf(getConfig())
      if (args.action !== 'set') throw new Error('action 必须是 get 或 set。')
      const settings = ctx.get('settings')
      if (settings === undefined) throw new Error('当前 profile 没有 settings 服务，无法保存连接配置。')
      const entryId = entryIdOf(ctx)
      if (entryId === undefined) throw new Error('找不到本插件的配置项，无法保存连接配置。')
      const patch = { setupDone: true }
      if (typeof args.mode === 'string') {
        if (args.mode !== 'wifi' && args.mode !== 'wired') throw new Error('mode 必须是 wifi 或 wired。')
        patch.mode = args.mode
      }
      if (typeof args.host === 'string' && args.host.trim() !== '') patch.host = args.host.trim()
      if (typeof args.user === 'string' && args.user.trim() !== '') patch.user = args.user.trim()
      if (typeof args.password === 'string' && args.password !== '') patch.password = args.password
      await settings.update(entryId, patch)
      exec.signal.throwIfAborted()
      return profileOf(getConfig())
    },
  }

  return [status, execTool, read, write, edit, configure]
}

/** Require a non-empty absolute-looking path argument. */
function requirePath(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('path 不能为空。')
  return value.trim()
}

/** Clamp an optional integer argument to [min, max] with a fallback. */
function clampInteger(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

/** Human-readable status rendering. */
function renderStatus(value) {
  if (value.reachable !== true) {
    return `G1 未连接（${value.target}）${value.error ? `\n${value.error}` : ''}`
  }
  const lines = [`G1 已连接：${value.target}（往返 ${value.latencyMs ?? '?'} ms）`]
  if (value.hostname) lines.push(`主机名：${value.hostname}`)
  if (value.kernel) lines.push(`内核：${value.kernel}`)
  if (value.user) lines.push(`用户：${value.user}${value.home ? `（home ${value.home}）` : ''}`)
  if (value.cwd) lines.push(`当前目录：${value.cwd}`)
  if (value.uptimeSec !== undefined) lines.push(`运行时长：${formatDuration(value.uptimeSec)}`)
  if (value.memTotalKb !== undefined) lines.push(`内存：${(value.memTotalKb / 1024 / 1024).toFixed(1)} GiB`)
  if (value.diskFreeKb !== undefined) lines.push(`home 可用空间：${(value.diskFreeKb / 1024 / 1024).toFixed(1)} GiB`)
  if (value.error) lines.push(`注意：${value.error}`)
  return lines.join('\n')
}

/** Human-readable exec rendering. */
function renderExec(value) {
  const meta = [`退出码 ${value.exitCode}`, `${value.durationMs} ms`]
  if (value.timedOut) meta.push('已超时')
  const lines = [meta.join(' · ')]
  if (value.stdout !== '') lines.push('--- stdout ---', value.stdout.replace(/\n$/, ''))
  if (value.stderr !== '') lines.push('--- stderr ---', value.stderr.replace(/\n$/, ''))
  if (value.stdout === '' && value.stderr === '') lines.push('（无输出）')
  return lines.join('\n')
}

/** Human-readable read rendering with line numbers. */
function renderRead(value) {
  const lines = [`${value.path}（第 ${value.start}-${value.end} 行，共 ${value.totalLines} 行）`]
  const width = String(value.end).length
  for (let index = 0; index < value.lines.length; index += 1) {
    const number = String(value.start + index).padStart(width, ' ')
    lines.push(`${number}→${value.lines[index]}`)
  }
  if (value.truncated) lines.push('…[内容被截断]')
  return lines.join('\n')
}

/** Human-readable connection profile rendering. */
function renderProfile(value) {
  const mode = value.mode === 'wired' ? '有线' : '无线'
  return [
    `连接方式：${mode}`,
    `地址：${value.host}:${value.port}`,
    `用户：${value.user}`,
    `密码：${value.passwordSet ? '已保存' : '未设置'}`,
  ].join('\n')
}

/** Compact duration text. */
function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return '未知'
  const seconds = Math.max(0, Math.trunc(totalSeconds))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (days > 0) parts.push(`${days} 天`)
  if (hours > 0) parts.push(`${hours} 小时`)
  if (minutes > 0) parts.push(`${minutes} 分钟`)
  if (parts.length === 0) parts.push(`${seconds} 秒`)
  return parts.join(' ')
}

/**
 * Register the G1 tools while this plugin is active.
 * @param {import('@deepseek-ai/cordis').Context} ctx - owning plugin context.
 * @param {Record<string, unknown>} [rawConfig] - bundle row config (volatile fields are live refs).
 */
export function apply(ctx, rawConfig) {
  const getConfig = () => resolveConfig(rawConfig)
  for (const definition of buildTools(ctx, getConfig)) {
    ctx.effect(() => ctx.tools.register(definition))
  }
}
