/**
 * What `GET /api/key` answers: the key the bearer names and its credits, as
 * far as the key store knows them. The CLI's `login` and `key` read it.
 */
export type KeyAnswer = {
  id: string;
  remaining?: number;
  limit?: number;
  resetsAt?: string;
};
