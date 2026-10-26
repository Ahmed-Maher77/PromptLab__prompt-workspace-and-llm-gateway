export type TokenEstimationMethod =
  | 'tiktoken:o200k_base'
  | 'tiktoken:cl100k_base'
  | `approximate:${string}`
  | 'heuristic:chars/4';

export interface TokenCountResult {
  tokens: number;
  method: TokenEstimationMethod;
  chunked?: boolean;
}

export interface ChatMessageLike {
  role: string;
  content: string;
}
