// OPS-001 + OPS-002 runtime verification against a live S3-compatible store (MinIO).
// Exercises the REAL api/files/storage.ts S3 backend: presign upload, PUT with SSE,
// object metadata (encryption at rest), presign download + GET, server-side stream
// upload, exists/delete. Prints a PASS/FAIL line per check.
import { S3Client, CreateBucketCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'

process.env.STORAGE_BACKEND = 's3'
process.env.S3_ENDPOINT = 'http://localhost:9100'
process.env.S3_BUCKET = 'denver-test'
process.env.S3_FORCE_PATH_STYLE = 'true'
process.env.AWS_REGION = 'us-east-1'
process.env.AWS_ACCESS_KEY_ID = 'minioadmin'
process.env.AWS_SECRET_ACCESS_KEY = 'minioadmin123'

const admin = new S3Client({
  region: 'us-east-1', endpoint: 'http://localhost:9100', forcePathStyle: true,
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin123' },
})

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  ok ? pass++ : fail++
}

async function main() {
  try { await admin.send(new CreateBucketCommand({ Bucket: 'denver-test' })) } catch { /* exists */ }

  const { getStorage, _resetStorage } = await import('../../api/files/storage.ts')
  _resetStorage()
  const storage = getStorage()

  const key = 'tenant-a/_global/' + Date.now() + '.txt'
  const body = 'denver-engineering OPS verification payload'

  // 1. presignUpload → signed URL + required SSE header
  const up = await storage.presignUpload(key, { mimeType: 'text/plain' })
  check('OPS-001 presignUpload returns signed URL', /X-Amz-Signature=/.test(up.uploadUrl), up.uploadUrl.split('?')[0])
  check('OPS-002 presign requires SSE header', up.requiredHeaders?.['x-amz-server-side-encryption'] === 'AES256')

  // 2. PUT to the presigned URL with the SSE header (acts as the client)
  const putRes = await fetch(up.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain', 'x-amz-server-side-encryption': 'AES256' },
    body,
  })
  check('OPS-001 upload via presigned PUT', putRes.ok, 'HTTP ' + putRes.status)

  // 3. object metadata — encryption at rest
  const head = await admin.send(new HeadObjectCommand({ Bucket: 'denver-test', Key: key }))
  check('OPS-002 object encrypted at rest (SSE=AES256)', head.ServerSideEncryption === 'AES256',
    'ServerSideEncryption=' + head.ServerSideEncryption)

  // 4. getMetadata via storage layer
  const meta = await storage.getMetadata(key)
  check('OPS-001 getMetadata returns size', (meta?.sizeBytes ?? 0) === body.length, 'size=' + meta?.sizeBytes)

  // 5. presignDownload → GET, content round-trips
  const dl = await storage.presignDownload(key, 600)
  check('OPS-001 presignDownload returns signed URL', /X-Amz-Signature=/.test(dl.downloadUrl))
  const got = await fetch(dl.downloadUrl)
  const gotBody = await got.text()
  check('OPS-001 download content matches', got.ok && gotBody === body, 'HTTP ' + got.status)

  // 6. server-side stream upload path (streamToKey) also encrypts
  const key2 = 'tenant-a/_global/stream-' + Date.now() + '.txt'
  await storage.streamToKey(key2, Readable.from([Buffer.from('stream path payload')]), 'text/plain')
  const head2 = await admin.send(new HeadObjectCommand({ Bucket: 'denver-test', Key: key2 }))
  check('OPS-002 streamToKey object encrypted (SSE=AES256)', head2.ServerSideEncryption === 'AES256',
    'ServerSideEncryption=' + head2.ServerSideEncryption)

  // 7. exists + delete
  check('OPS-001 objectExists true', await storage.objectExists(key))
  await storage.deleteObject(key)
  check('OPS-001 objectExists false after delete', !(await storage.objectExists(key)))

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error('FATAL', e); process.exit(2) })
