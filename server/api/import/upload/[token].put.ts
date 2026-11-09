import { IMPORT_LIMITS } from '../../../utils/importConvert'
import { peekUpload, runUpload } from '../../../utils/imports'
import { memberById } from '../../../utils/betterAuth'
import { baseUrl } from '../../../utils/oauth'

// Receives a page saved from claude.ai, sent with curl to a link from `request_import`. The link is the credential
// (one use, 60 minutes, bound to the member who asked), so no session is needed. Answers with the import report.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token') ?? ''
  const row = peekUpload(token)
  const max = IMPORT_LIMITS.sourceBytes
  const declared = Number(getHeader(event, 'content-length') ?? 0)
  if (declared > max) throw createError({ statusCode: 413, statusMessage: `Too large (max ${max / 1024 / 1024} MB)` })

  // Read at most max bytes, so a body without a content-length cannot fill memory.
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    size += (chunk as Buffer).length
    if (size > max) { event.node.req.destroy(); throw createError({ statusCode: 413, statusMessage: `Too large (max ${max / 1024 / 1024} MB)` }) }
    chunks.push(chunk as Buffer)
  }
  if (!size) throw createError({ statusCode: 400, statusMessage: 'Send the saved page as the request body (curl --data-binary @file)' })

  event.context.member = memberById(row.member_id) // the activity log names the member who asked for the link
  return runUpload(token, Buffer.concat(chunks), baseUrl(event))
})
