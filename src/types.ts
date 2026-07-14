import { z } from 'zod'

export const ProspectSchema = z.object({
  url: z.url(),
  userId: z.string()
})

export type ProspectScrapeBody = z.infer<typeof ProspectSchema>