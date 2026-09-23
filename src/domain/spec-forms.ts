import { z } from "zod";

/**
 * A Validity Issue: findings that share a message, grouped. `path` is the
 * JSON pointer of the first finding with that message, and `count` how many
 * findings share it.
 */
export const ValidityIssue = z.object({
  message: z.string(),
  path: z.string(),
  count: z.number().int().positive(),
});
export type ValidityIssue = z.infer<typeof ValidityIssue>;

/**
 * A Spec Outline, derived mechanically from the Normalized Form, never from a
 * Judge (ADR 0001). `operations` follow the order of the Normalized Form's
 * `paths`, with `method` lowercase. `tags` come in the order of the
 * document's `tags` array, then any that appear only on operations.
 */
export const SpecOutline = z.object({
  title: z.string().nullable(),
  apiVersion: z.string().nullable(),
  servers: z.array(z.string()),
  securitySchemes: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      scheme: z.string().optional(),
      in: z.string().optional(),
    }),
  ),
  tags: z.array(
    z.object({
      name: z.string(),
      operationCount: z.number().int().nonnegative(),
    }),
  ),
  operations: z.array(
    z.object({
      method: z.string(),
      path: z.string(),
      operationId: z.string().optional(),
      summary: z.string().optional(),
      tags: z.array(z.string()),
      deprecated: z.literal(true).optional(),
    }),
  ),
});
export type SpecOutline = z.infer<typeof SpecOutline>;
