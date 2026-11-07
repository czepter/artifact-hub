import { requireEditor } from '../../utils/auth'
import { publish, type FileInput } from '../../utils/store'

export default defineEventHandler(async (event) => {
  requireEditor(event)
  const b = await readBody<{ title: string, files: FileInput[], label?: string }>(event)
  return publish({ title: b.title, files: b.files, label: b.label })
})
