// skills/canvas-refresh/scripts/canvas-files.ts
// preserve and verify browser downloads before mirroring course materials

import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

interface Config
{
  root: string
  remote: string
  writeRemote?: string
  baseUrl: string
  profileId: string
  courses: Record<string, { id: number }>
  driveWriteMode?: 'rclone' | 'connector'
  connectorUploadLimitBytes?: number
}

interface Artifact
{
  key?: string
  course?: string
  fileId?: number
  filename?: string
  source?: string
  expectedBytes?: number
  updatedAt?: string
  downloadPath?: string
  relativePath?: string
  content?: string
  bytes?: number
  sha256?: string
  md5?: string
  status?: 'discovered' | 'installed' | 'uploaded' | 'failed'
  changed?: boolean
  error?: string
  driveId?: string
  driveBackup?: string
  uploadChanged?: boolean
  remoteBefore?: RemoteFile
  connectorPending?: boolean
}

interface Coverage
{
  course: string
  section: string
  status: 'complete' | 'unavailable' | 'needs-login' | 'partial'
  source: string
  note?: string
}

interface Receipt
{
  id: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'partial' | 'complete'
  config: Config
  artifacts: Record<string, Artifact>
  coverage: Coverage[]
}

interface RemoteFile
{
  Name: string
  Size: number
  ID?: string
  MimeType: string
  Hashes?: Record<string, string>
}

type ManifestRow = Record<string, unknown>

const stateHome = path.resolve(
  process.env.CANVAS_REFRESH_HOME ||
    path.join(os.homedir(), '.local/share/canvas-refresh')
)
const requiredSections = [
  'home',
  'modules',
  'assignments',
  'announcements',
  'syllabus',
  'pages',
  'files',
]

function fail(message: string): never
{
  throw new Error(message)
}

async function exists(file: string)
{
  return fs.stat(file).then(
    () => true,
    () => false
  )
}

async function readJson<T>(file: string): Promise<T>
{
  return JSON.parse(await fs.readFile(file, 'utf8')) as T
}

async function atomicWrite(file: string, content: string)
{
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = file + '.' + randomUUID() + '.tmp'
  await fs.writeFile(temporary, content, { mode: 0o600 })
  await fs.rename(temporary, file)
}

async function writeJson(file: string, value: unknown)
{
  await atomicWrite(file, JSON.stringify(value, null, 2) + '\n')
}

function runDirectory(id: string)
{
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('Invalid run ID')
  return path.join(stateHome, 'runs', id)
}

async function digest(file: string)
{
  const sha256 = createHash('sha256')
  const md5 = createHash('md5')
  for await (const chunk of createReadStream(file))
  {
    sha256.update(chunk)
    md5.update(chunk)
  }
  return {
    sha256: sha256.digest('hex'),
    md5: md5.digest('hex'),
    bytes: (await fs.stat(file)).size,
  }
}

function command(binary: string, args: string[])
{
  try
  {
    return execFileSync(binary, args, {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  catch
  {
    fail(binary + ' failed; retained local artifacts for inspection or retry')
  }
}

async function validate(file: string, name: string, expectedBytes?: number)
{
  const hashes = await digest(file)
  if (!hashes.bytes) fail('Empty download')
  if (expectedBytes !== undefined && hashes.bytes !== expectedBytes)
    fail('Download size does not match the observed Canvas size')
  const handle = await fs.open(file, 'r')
  const prefix = Buffer.alloc(4096)
  try
  {
    await handle.read(prefix, 0, prefix.length, 0)
  }
  finally
  {
    await handle.close()
  }
  const text = prefix.toString('utf8').trimStart()
  if (/^(<!doctype html|<html|<head|<body)/i.test(text))
    fail('HTML response is not an original attachment')
  const extension = path.extname(name).toLowerCase()
  if (extension === '.pdf')
  {
    if (!text.startsWith('%PDF-')) fail('Invalid PDF signature')
    command('pdfinfo', [file])
  }
  if (['.zip', '.pptx', '.docx', '.xlsx'].includes(extension))
    command('unzip', ['-t', file])
  command('file', ['--brief', file])
  return hashes
}

async function localPath(config: Config, relativePath: string)
{
  const parts = relativePath.split('/')
  const course = parts[0]
  const allowedRootDocument = ['WORK.md', 'Canvas Courses.md'].includes(
    relativePath
  )
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    parts.some(
      (part) => !part || part === '.' || part === '..' || part.includes('\\')
    ) ||
    (!allowedRootDocument &&
      !(course in config.courses && parts[1] === 'Canvas'))
  )
    fail('Destination is outside the configured Canvas materials')
  const root = await fs.realpath(config.root)
  let parent = root
  for (const part of parts.slice(0, -1))
  {
    parent = path.join(parent, part)
    if (await exists(parent))
    {
      const real = await fs.realpath(parent)
      if (real !== root && !real.startsWith(root + path.sep))
        fail('Symlink leaves course root')
    }
  }
  const target = path.join(root, ...parts)
  const info = await fs.lstat(target).catch(() => null)
  if (info?.isSymbolicLink()) fail('Refusing to replace a symlink')
  return target
}

function observedSource(config: Config, item: Artifact)
{
  const course = config.courses[item.course || '']
  if (!course || !Number.isSafeInteger(item.fileId) || !item.source)
    fail(
      'Attachment needs a configured course, file ID, and observed Canvas source'
    )
  const source = new URL(item.source)
  if (
    source.origin !== new URL(config.baseUrl).origin ||
    source.pathname !== '/courses/' + course.id + '/files/' + item.fileId
  )
    fail(
      'Attachment source does not match its configured Canvas course and file ID'
    )
  return source.origin + source.pathname
}

async function preserveLocal(
  receipt: Receipt,
  relativePath: string,
  target: string
)
{
  if (!(await exists(target))) return
  const previous = await digest(target)
  const backup = path.join(
    runDirectory(receipt.id),
    'recovery',
    previous.sha256,
    relativePath
  )
  if (!(await exists(backup)))
  {
    await fs.mkdir(path.dirname(backup), { recursive: true, mode: 0o700 })
    await fs.copyFile(target, backup)
    await fs.chmod(backup, 0o600)
  }
}

async function install(receipt: Receipt, item: Artifact, staged: string)
{
  const target = await localPath(receipt.config, item.relativePath!)
  const unchanged =
    (await exists(target)) && (await digest(target)).sha256 === item.sha256
  if (!unchanged)
  {
    await preserveLocal(receipt, item.relativePath!, target)
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    const temporary = target + '.' + randomUUID() + '.tmp'
    await fs.copyFile(staged, temporary)
    await fs.chmod(temporary, 0o600)
    await fs.rename(temporary, target)
  }
  item.changed = !unchanged
  item.status = 'installed'
  delete item.error
}

async function ingest(receipt: Receipt, input: Artifact)
{
  const source = observedSource(receipt.config, input)
  const key = input.course + ':' + input.fileId
  const item = (receipt.artifacts[key] = {
    ...receipt.artifacts[key],
    ...input,
    source,
  })
  delete item.sha256
  delete item.md5
  delete item.bytes
  delete item.driveId
  if (
    !item.filename ||
    item.filename !== path.basename(item.filename) ||
    /[\x00-\x1f\\/]/.test(item.filename) ||
    item.filename === '.' ||
    item.filename === '..'
  )
    fail('Attachment needs a safe original filename')
  if (!item.downloadPath) fail('A completed browser download path is required')
  const staged = path.join(
    runDirectory(receipt.id),
    'downloads',
    String(item.fileId),
    item.filename
  )
  await fs.mkdir(path.dirname(staged), { recursive: true, mode: 0o700 })
  if (path.resolve(item.downloadPath) !== staged)
    await fs.copyFile(item.downloadPath, staged)
  await fs.chmod(staged, 0o600)
  delete item.downloadPath
  const hashes = await validate(staged, item.filename, item.expectedBytes)
  Object.assign(item, hashes)
  const manifestPath = path.join(
    receipt.config.root,
    item.course!,
    'Canvas/file-manifest.json'
  )
  const rows = (await exists(manifestPath))
    ? await readJson<ManifestRow[]>(manifestPath)
    : []
  const previous = rows.find(
    (row) =>
      row.file_id === item.fileId &&
      !row.retained_older_source &&
      !row.retired_at &&
      typeof row.path === 'string' &&
      row.path.startsWith(item.course + '/Canvas/files/') &&
      path.posix.normalize(row.path) === row.path
  )
  item.relativePath =
    typeof previous?.path === 'string'
      ? previous.path
      : item.course + '/Canvas/files/' + item.filename
  const collision = rows.find(
    (row) => row.path === item.relativePath && row.file_id !== item.fileId
  )
  if (collision)
    item.relativePath =
      item.course +
      '/Canvas/files/' +
      path.parse(item.filename).name +
      '.canvas-' +
      item.fileId +
      path.extname(item.filename)
  await install(receipt, item, staged)
  const row = {
    ...previous,
    course: item.course,
    file_id: item.fileId,
    path: item.relativePath,
    bytes: item.bytes,
    sha256: item.sha256,
    source,
    verified_at:
      previous &&
      previous.sha256 === item.sha256 &&
      typeof previous.verified_at === 'string'
        ? previous.verified_at
        : new Date().toISOString(),
    evidence_type: 'original_canvas_attachment',
    original_attachment_downloaded: true,
    acquired_from: '456code browser completed download',
    ...(item.updatedAt ? { canvas_updated_at: item.updatedAt } : {}),
  }
  const next = previous
    ? rows.map((entry) => (entry === previous ? row : entry))
    : [...rows, row]
  await capture(receipt, {
    relativePath: item.course + '/Canvas/file-manifest.json',
    content: JSON.stringify(next, null, 2) + '\n',
  })
  return item
}

async function capture(receipt: Receipt, input: Artifact)
{
  if (!input.relativePath || typeof input.content !== 'string')
    fail('Capture needs relativePath and UTF-8 content')
  if (
    !/\.(md|json|ics)$/.test(input.relativePath) ||
    input.relativePath.includes('/files/')
  )
    fail('Capture only writes course metadata documents')
  await localPath(receipt.config, input.relativePath)
  const staged = path.join(
    runDirectory(receipt.id),
    'documents',
    input.relativePath
  )
  await atomicWrite(staged, input.content)
  const item: Artifact = {
    relativePath: input.relativePath,
    ...(await digest(staged)),
  }
  receipt.artifacts['document:' + input.relativePath] = item
  await install(receipt, item, staged)
  return item
}

function remoteFiles(remote: string): RemoteFile[]
{
  try
  {
    return JSON.parse(
      execFileSync(
        'rclone',
        ['lsjson', remote, '--max-depth', '1', '--files-only', '--hash'],
        {
          encoding: 'utf8',
          timeout: 120_000,
          maxBuffer: 4 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      )
    )
  }
  catch (error)
  {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr)
        : ''
    if (/directory not found/i.test(stderr)) return []
    fail('Drive listing failed; no files were changed')
  }
}

function sameRemote(remote: RemoteFile, item: Artifact)
{
  return (
    remote.Size === item.bytes &&
    (remote.Hashes?.sha256 === item.sha256 || remote.Hashes?.md5 === item.md5)
  )
}

function remotePath(root: string, relativePath: string)
{
  const prefix = root.replace(/\/$/, '')
  return prefix + (prefix.endsWith(':') ? '' : '/') + relativePath
}

async function publishOne(
  receipt: Receipt,
  item: Artifact,
  listings: Map<string, RemoteFile[]>
)
{
  const local = await localPath(receipt.config, item.relativePath!)
  if ((await digest(local)).sha256 !== item.sha256)
    fail('Local content changed after verification')
  const remote =
    receipt.config.remote.replace(/\/$/, '') + '/' + item.relativePath
  const writeRoot = receipt.config.writeRemote || receipt.config.remote
  const writeDestination = remotePath(writeRoot, item.relativePath!)
  const directory = remote.slice(0, remote.lastIndexOf('/'))
  if (!listings.has(directory)) listings.set(directory, remoteFiles(directory))
  const matches = listings
    .get(directory)!
    .filter((entry) => entry.Name === path.basename(local))
  if (matches.length > 1)
    fail('Ambiguous duplicate names on Drive; leaving this item pending')
  const previous = matches[0]
  if (item.driveId && previous && item.driveId !== previous.ID)
    fail('Drive identity changed since the earlier upload attempt')
  if (previous?.MimeType.startsWith('application/vnd.google-apps.'))
    fail('Refusing to replace a native Google document')
  if (previous?.ID)
  {
    item.driveId = previous.ID
    await saveReceipt(receipt)
  }
  if (previous && !sameRemote(previous, item))
  {
    const backup =
      receipt.config.remote.replace(/\/$/, '') +
      '/.canvas-recovery/' +
      receipt.id +
      '/' +
      item.relativePath +
      '.' +
      (previous.Hashes?.md5 || previous.ID)
    if (item.driveBackup !== backup)
    {
      const writeBackup = remotePath(
        writeRoot,
        '.canvas-recovery/' +
          receipt.id +
          '/' +
          item.relativePath +
          '.' +
          (previous.Hashes?.md5 || previous.ID)
      )
      command('rclone', [
        'copyto',
        remote,
        writeBackup,
        '--checksum',
        '--retries',
        '1',
      ])
      const copied = remoteFiles(backup.slice(0, backup.lastIndexOf('/'))).find(
        (entry) => entry.Name === backup.slice(backup.lastIndexOf('/') + 1)
      )
      if (
        !copied ||
        copied.Size !== previous.Size ||
        !(
          (copied.Hashes?.md5 && copied.Hashes.md5 === previous.Hashes?.md5) ||
          (copied.Hashes?.sha256 &&
            copied.Hashes.sha256 === previous.Hashes?.sha256)
        )
      )
        fail('Drive recovery copy did not verify')
      item.driveBackup = backup
      await saveReceipt(receipt)
    }
  }
  if (!previous || !sameRemote(previous, item))
  {
    const current = remoteFiles(directory).filter(
      (entry) => entry.Name === path.basename(local)
    )
    if (
      previous &&
      (current.length !== 1 ||
        current[0].ID !== previous.ID ||
        !sameRemote(current[0], {
          bytes: previous.Size,
          sha256: previous.Hashes?.sha256,
          md5: previous.Hashes?.md5,
        }))
    )
      fail(
        'Drive content changed during backup; preserved local files for review'
      )
    if (!previous && current.length)
      fail('A Drive file appeared during upload preparation')
    item.uploadChanged = true
    await saveReceipt(receipt)
    command('rclone', [
      'copyto',
      local,
      writeDestination,
      '--checksum',
      '--retries',
      '1',
    ])
    listings.set(directory, remoteFiles(directory))
  }
  const after = listings
    .get(directory)!
    .filter((entry) => entry.Name === path.basename(local))
  if (after.length !== 1 || !sameRemote(after[0], item) || !after[0].ID)
    fail('Uploaded file did not verify against its local checksum')
  if (previous?.ID && after[0].ID !== previous.ID)
    fail('Drive replacement changed its file ID')
  item.driveId = after[0].ID
  item.uploadChanged ||= item.connectorPending
  item.status = 'uploaded'
  delete item.connectorPending
  delete item.error
}

async function saveReceipt(receipt: Receipt)
{
  await writeJson(path.join(runDirectory(receipt.id), 'receipt.json'), receipt)
}

async function publish(receipt: Receipt)
{
  const listings = new Map<string, RemoteFile[]>()
  for (const item of Object.values(receipt.artifacts))
  {
    if (!item.relativePath || !item.sha256) continue
    try
    {
      await publishOne(receipt, item, listings)
    }
    catch (error)
    {
      item.status = 'failed'
      item.error = error instanceof Error ? error.message : String(error)
    }
    await saveReceipt(receipt)
  }
}

async function connectorPlan(receipt: Receipt, verify: boolean)
{
  const listings = new Map<string, RemoteFile[]>()
  const uploads = []
  for (const [key, item] of Object.entries(receipt.artifacts))
  {
    if (!item.relativePath || !item.sha256) continue
    try
    {
      const local = await localPath(receipt.config, item.relativePath)
      if ((await digest(local)).sha256 !== item.sha256)
        fail('Local content changed after verification')
      const remote =
        receipt.config.remote.replace(/\/$/, '') + '/' + item.relativePath
      const directory = remote.slice(0, remote.lastIndexOf('/'))
      if (!listings.has(directory))
        listings.set(directory, remoteFiles(directory))
      const matches = listings
        .get(directory)!
        .filter((entry) => entry.Name === path.basename(local))
      if (matches.length > 1) fail('Ambiguous duplicate names on Drive')
      const previous = matches[0]
      if (previous?.MimeType.startsWith('application/vnd.google-apps.'))
        fail('Refusing to replace a native Google document')
      if (item.driveId && previous && item.driveId !== previous.ID)
        fail('Drive identity changed')
      if (previous && sameRemote(previous, item))
      {
        if (item.connectorPending && item.remoteBefore && !item.driveBackup)
          fail(
            'Replacement is present but its required recovery copy has not been verified'
          )
        item.uploadChanged ||= item.connectorPending
        item.driveId = previous.ID
        item.status = 'uploaded'
        delete item.connectorPending
        delete item.error
        continue
      }
      if (verify) fail('Remote file does not match the verified local content')
      if (
        previous &&
        item.remoteBefore &&
        !sameRemote(previous, {
          bytes: item.remoteBefore.Size,
          sha256: item.remoteBefore.Hashes?.sha256,
          md5: item.remoteBefore.Hashes?.md5,
        })
      )
        delete item.driveBackup
      item.remoteBefore = previous
      item.driveId = previous?.ID
      item.connectorPending = true
      item.status = 'installed'
      delete item.error
      uploads.push({
        key,
        localPath: local,
        relativePath: item.relativePath,
        remote,
        existingId: previous?.ID,
        parentRemote: directory,
        bytes: item.bytes,
        browserUploadRequired:
          !!receipt.config.connectorUploadLimitBytes &&
          item.bytes! > receipt.config.connectorUploadLimitBytes,
        needsBackup: !!previous && !item.driveBackup,
        previous,
      })
    }
    catch (error)
    {
      item.status = 'failed'
      item.error = error instanceof Error ? error.message : String(error)
    }
  }
  await saveReceipt(receipt)
  await writeJson(
    path.join(runDirectory(receipt.id), 'upload-plan.json'),
    uploads
  )
  return uploads
}

async function recordConnectorBackup(receipt: Receipt, input: Artifact)
{
  const item = receipt.artifacts[input.key || '']
  if (!item?.remoteBefore || !input.driveBackup)
    fail('Backup needs a pending existing artifact and recovery path')
  const prefix =
    receipt.config.remote.replace(/\/$/, '') +
    '/.canvas-recovery/' +
    receipt.id +
    '/'
  if (!input.driveBackup.startsWith(prefix))
    fail('Backup is outside this run recovery folder')
  const directory = input.driveBackup.slice(
    0,
    input.driveBackup.lastIndexOf('/')
  )
  const backups = remoteFiles(directory).filter(
    (entry) => entry.Name === path.posix.basename(input.driveBackup!)
  )
  const expected = {
    bytes: item.remoteBefore.Size,
    sha256: item.remoteBefore.Hashes?.sha256,
    md5: item.remoteBefore.Hashes?.md5,
  }
  if (backups.length !== 1 || !sameRemote(backups[0], expected))
    fail('Connector recovery copy did not verify')
  const remote =
    receipt.config.remote.replace(/\/$/, '') + '/' + item.relativePath
  const current = remoteFiles(remote.slice(0, remote.lastIndexOf('/'))).filter(
    (entry) => entry.ID === item.remoteBefore!.ID
  )
  if (current.length !== 1 || !sameRemote(current[0], expected))
    fail('Original Drive content changed during backup')
  item.driveBackup = input.driveBackup
}

function summarize(receipt: Receipt)
{
  const artifacts = Object.entries(receipt.artifacts)
  return {
    runId: receipt.id,
    status: receipt.status,
    counts: Object.fromEntries(
      ['discovered', 'installed', 'uploaded', 'failed'].map((status) => [
        status,
        artifacts.filter(([, item]) => item.status === status).length,
      ])
    ),
    changed: artifacts.filter(([, item]) => item.changed).length,
    copiedToDrive: artifacts.filter(([, item]) => item.uploadChanged).length,
    pending: artifacts
      .filter(([, item]) => item.status !== 'uploaded')
      .map(([key, item]) => ({
        key,
        path: item.relativePath,
        status: item.status,
        error: item.error,
      })),
    coverage: receipt.coverage,
  }
}

async function start()
{
  const config = await readJson<Config>(path.join(stateHome, 'config.json'))
  if (
    !path.isAbsolute(config.root) ||
    !config.remote ||
    !new URL(config.baseUrl).origin ||
    !Object.keys(config.courses).length
  )
    fail('Invalid Canvas refresh configuration')
  const id =
    new Date().toISOString().replace(/[^0-9TZ]/g, '') +
    '_' +
    randomUUID().slice(0, 8)
  const receipt: Receipt = {
    id,
    startedAt: new Date().toISOString(),
    status: 'running',
    config,
    artifacts: {},
    coverage: [],
  }
  await saveReceipt(receipt)
  return {
    runId: id,
    config,
    receiptPath: path.join(runDirectory(id), 'receipt.json'),
  }
}

async function main()
{
  const [operation, id] = process.argv.slice(2)
  if (operation === 'start') return start()
  if (!id)
    fail(
      'Usage: node canvas-files.ts start | <status|discover|ingest|capture|coverage|publish|finish> RUN_ID'
    )
  const lock = path.join(stateHome, '.lock')
  const receiptPath = path.join(runDirectory(id), 'receipt.json')
  if (operation === 'status')
    return summarize(await readJson<Receipt>(receiptPath))
  await fs.access(receiptPath)
  await fs
    .mkdir(lock)
    .catch(() =>
      fail('Run is locked; inspect its owner before recovering the lock')
    )
  await writeJson(path.join(lock, 'owner.json'), {
    pid: process.pid,
    runId: id,
    startedAt: new Date().toISOString(),
  })
  let receipt: Receipt | undefined
  let input: Artifact | Artifact[] | Coverage | null = null
  try
  {
    receipt = await readJson<Receipt>(receiptPath)
    if (
      ['discover', 'ingest', 'capture', 'coverage', 'backup'].includes(
        operation
      )
    )
    {
      const chunks = []
      for await (const chunk of process.stdin) chunks.push(chunk)
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }
    if (operation === 'discover')
    {
      for (const item of input as Artifact[])
      {
        const source = observedSource(receipt.config, item)
        const key = item.course + ':' + item.fileId
        receipt.artifacts[key] = {
          ...item,
          ...receipt.artifacts[key],
          source,
          status: receipt.artifacts[key]?.status || 'discovered',
        }
      }
    }
    else if (operation === 'ingest') await ingest(receipt, input as Artifact)
    else if (operation === 'capture') await capture(receipt, input as Artifact)
    else if (operation === 'coverage')
    {
      const entry = input as Coverage
      if (
        !(entry.course in receipt.config.courses) ||
        !requiredSections.includes(entry.section) ||
        !['complete', 'unavailable', 'needs-login', 'partial'].includes(
          entry.status
        )
      )
        fail('Invalid coverage entry')
      receipt.coverage = receipt.coverage.filter(
        (row) => row.course !== entry.course || row.section !== entry.section
      )
      receipt.coverage.push(entry)
    }
    else if (operation === 'backup')
      await recordConnectorBackup(receipt, input as Artifact)
    else if (
      operation === 'publish' &&
      receipt.config.driveWriteMode === 'connector'
    )
    {
      const uploads = await connectorPlan(receipt, false)
      return { ...summarize(receipt), uploads }
    }
    else if (operation === 'verify') await connectorPlan(receipt, true)
    else if (operation === 'publish') await publish(receipt)
    else if (operation === 'finish')
    {
      const coverage = receipt.coverage
      const covered = Object.keys(receipt.config.courses).every((course) =>
        requiredSections.every((section) =>
          coverage.some(
            (entry) =>
              entry.course === course &&
              entry.section === section &&
              entry.status === 'complete'
          )
        )
      )
      receipt.status =
        covered &&
        Object.values(receipt.artifacts).every(
          (item) => item.status === 'uploaded'
        )
          ? 'complete'
          : 'partial'
      receipt.finishedAt = new Date().toISOString()
    }
    else fail('Unknown operation')
    await saveReceipt(receipt)
    return summarize(receipt)
  }
  catch (error)
  {
    if (receipt)
    {
      if (operation === 'ingest' && input && !Array.isArray(input))
      {
        const attachment = input as Artifact
        const key = attachment.course + ':' + attachment.fileId
        const item = receipt.artifacts[key]
        if (item)
        {
          item.status = 'failed'
          item.error = error instanceof Error ? error.message : String(error)
          delete item.downloadPath
        }
      }
      receipt.status = 'partial'
      await saveReceipt(receipt)
    }
    throw error
  }
  finally
  {
    await fs.rm(lock, { recursive: true })
  }
}

main()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) =>
  {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
