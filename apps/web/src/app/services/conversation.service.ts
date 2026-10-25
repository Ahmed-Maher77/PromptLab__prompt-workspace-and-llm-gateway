import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { generateIdempotencyKey } from '../utils/uuid.util';
import { retryTransientErrors } from '../utils/http-retry.util';

export interface ConversationSummary {
  id: string;
  title: string;
  provider: string;
  model: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  checkpointCount: number;
  hasActiveCheckpoint: boolean;
  lastMessageSnippet: string | null;
  lastMessageRole: string | null;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  sequenceNumber: number;
  status?: 'complete' | 'failed';
  inputTokens?: number | null;
  outputTokens?: number | null;
  tokenUsageSource?: 'estimated' | 'provider-reported' | null;
  createdAt: string;
}

export interface ConversationCheckpoint {
  id: string;
  conversationId: string;
  summary: string;
  retainedFacts: string[];
  compactedThroughSequence: number;
  contextPolicyVersion: string;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  title: string;
  provider: string;
  model: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
  checkpoints: ConversationCheckpoint[];
  activeCheckpoint: ConversationCheckpoint | null;
}

export interface CreateConversationPayload {
  title?: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  contextBudget?: number;
}

export interface AssembledContextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  source: 'system-instruction' | 'checkpoint-summary' | 'retained-message' | 'current-input';
  sequenceNumber?: number;
  estimatedTokens: number;
}

export interface ContextInspectionResult {
  model: string;
  provider: string;
  contextWindow: number | null;
  contextLimitStatus: 'known' | 'unknown';
  inputBudget: number;
  reservedOutputTokens: number;
  totalEstimatedInputTokens: number;
  tokenUsageSource: 'estimated';
  isCompacted: boolean;
  activeCheckpoint: {
    id: string;
    summary: string;
    retainedFacts: string[];
    compactedThroughSequence: number;
    createdAt: string;
  } | null;
  totalOriginalMessages: number;
  retainedMessagesCount: number;
  compactedMessagesCount: number;
  assembledMessages: AssembledContextMessage[];
  withinBudget: boolean;
}

export interface CompactionPreviewResult {
  conversationId: string;
  compactThroughSequence: number;
  messagesToCompactCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  tokenSavings: number;
  proposedSummary: string;
  proposedRetainedFacts: string[];
  providerReported: boolean;
  providerError: string | null;
}

export interface ApplyCompactionPayload {
  summary: string;
  retainedFacts: string[];
  compactedThroughSequence: number;
}

export interface SendMessageResponse {
  success: boolean;
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage | null;
  latencyMs?: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    source: 'provider-reported' | 'estimated';
  };
  errorType?: string;
  errorMessage?: string;
  configurationHint?: string;
}

export interface ResumeResult {
  success: boolean;
  conversationId: string;
  title: string;
  model: string;
  provider: string;
  activeCheckpoint: ConversationCheckpoint | null;
  contextInspection: ContextInspectionResult;
  originalMessagesRetained: number;
  message: string;
}

@Injectable({
  providedIn: 'root',
})
export class ConversationService {
  private readonly baseUrl = '/api/conversations';

  constructor(private readonly http: HttpClient) {}

  getConversations(pagination?: { limit?: number; offset?: number }): Observable<ConversationSummary[]> {
    let url = this.baseUrl;
    const params: string[] = [];
    if (pagination?.limit !== undefined) {
      params.push(`limit=${pagination.limit}`);
    }
    if (pagination?.offset !== undefined) {
      params.push(`offset=${pagination.offset}`);
    }
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
    return this.http.get<ConversationSummary[]>(url);
  }

  getConversation(id: string): Observable<ConversationDetail> {
    return this.http.get<ConversationDetail>(`${this.baseUrl}/${id}`);
  }

  createConversation(payload: CreateConversationPayload): Observable<ConversationDetail> {
    return this.http.post<ConversationDetail>(this.baseUrl, payload);
  }

  deleteConversation(id: string): Observable<{ success: boolean; id: string }> {
    return this.http.delete<{ success: boolean; id: string }>(`${this.baseUrl}/${id}`);
  }

  inspectContext(id: string, proposedInput?: string): Observable<ContextInspectionResult> {
    const params = proposedInput ? `?proposedInput=${encodeURIComponent(proposedInput)}` : '';
    return this.http.get<ContextInspectionResult>(`${this.baseUrl}/${id}/context${params}`);
  }

  sendMessage(id: string, content: string, idempotencyKey?: string): Observable<SendMessageResponse> {
    const key = idempotencyKey || generateIdempotencyKey();
    const headers = new HttpHeaders({
      'Idempotency-Key': key,
    });
    return this.http
      .post<SendMessageResponse>(`${this.baseUrl}/${id}/messages`, { content }, { headers })
      .pipe(retryTransientErrors());
  }

  previewCompaction(id: string, compactThroughSequence?: number, idempotencyKey?: string): Observable<CompactionPreviewResult> {
    const key = idempotencyKey || generateIdempotencyKey();
    const headers = new HttpHeaders({
      'Idempotency-Key': key,
    });
    return this.http
      .post<CompactionPreviewResult>(`${this.baseUrl}/${id}/compact/preview`, {
        compactThroughSequence,
      }, { headers })
      .pipe(retryTransientErrors());
  }

  applyCompaction(id: string, payload: ApplyCompactionPayload): Observable<any> {
    return this.http.post(`${this.baseUrl}/${id}/compact/apply`, payload);
  }

  resume(id: string, checkpointId?: string): Observable<ResumeResult> {
    const params = checkpointId ? `?checkpointId=${encodeURIComponent(checkpointId)}` : '';
    return this.http.post<ResumeResult>(`${this.baseUrl}/${id}/resume${params}`, {});
  }
}
