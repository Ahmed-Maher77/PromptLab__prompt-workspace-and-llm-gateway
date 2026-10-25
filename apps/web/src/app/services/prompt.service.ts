import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { generateIdempotencyKey } from '../utils/uuid.util';
import { retryTransientErrors } from '../utils/http-retry.util';

export interface PromptVariable {
  name: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface FewShotExample {
  input: string;
  output: string;
}

export interface ModelDefaults {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface PromptSummary {
  id: string;
  name: string;
  description: string | null;
  techniques: string[];
  versionCount: number;
  latestVersionNumber: number;
  latestTemplateBody: string;
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    displayName: string;
    email: string;
  };
}

export interface PromptVersionDetail {
  id: string;
  versionNumber: number;
  templateBody: string;
  variables: PromptVariable[];
  examples: FewShotExample[];
  outputSchema: Record<string, unknown> | null;
  modelDefaults: ModelDefaults;
  createdAt: string;
  createdBy: string;
}

export interface PromptDetail {
  id: string;
  name: string;
  description: string | null;
  techniques: string[];
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    displayName: string;
    email: string;
  };
  versions: PromptVersionDetail[];
}

export interface CreatePromptPayload {
  name: string;
  description?: string;
  techniques?: string[];
  templateBody: string;
  variables?: PromptVariable[];
  examples?: FewShotExample[];
  outputSchema?: Record<string, unknown>;
  modelDefaults?: ModelDefaults;
}

export interface CreateVersionPayload {
  templateBody: string;
  variables?: PromptVariable[];
  examples?: FewShotExample[];
  outputSchema?: Record<string, unknown>;
  modelDefaults?: ModelDefaults;
  name?: string;
  description?: string;
  techniques?: string[];
}

export interface ResolvedPreview {
  resolvedPrompt: string;
  detectedVariables: string[];
  missingVariables: string[];
  characterCount: number;
  estimatedTokens: number;
}

export interface CompletionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: 'provider-reported' | 'estimated';
}

export interface PlaygroundRunResult {
  success: boolean;
  model: string;
  content?: string;
  latencyMs: number;
  usage?: CompletionUsage;
  errorType?: 'provider_auth_error' | 'provider_quota_error' | 'gateway_unreachable' | 'model_error' | 'timeout';
  errorMessage?: string;
  configurationHint?: string;
  resolvedPrompt: string;
}

export interface ModelMetadata {
  id: string;
  name: string;
  provider: string;
  description?: string;
}

@Injectable({
  providedIn: 'root',
})
export class PromptService {
  private readonly baseUrl = '/api/prompts';
  private readonly providersUrl = '/api/providers';

  constructor(private readonly http: HttpClient) {}

  getPrompts(filter?: {
    search?: string;
    technique?: string;
    limit?: number;
    offset?: number;
  }): Observable<PromptSummary[]> {
    let params = new HttpParams();
    if (filter?.search) {
      params = params.set('search', filter.search);
    }
    if (filter?.technique && filter.technique !== 'all') {
      params = params.set('technique', filter.technique);
    }
    if (filter?.limit !== undefined) {
      params = params.set('limit', filter.limit.toString());
    }
    if (filter?.offset !== undefined) {
      params = params.set('offset', filter.offset.toString());
    }
    return this.http.get<PromptSummary[]>(this.baseUrl, { params });
  }

  getPrompt(id: string): Observable<PromptDetail> {
    return this.http.get<PromptDetail>(`${this.baseUrl}/${id}`);
  }

  createPrompt(payload: CreatePromptPayload): Observable<PromptDetail> {
    return this.http.post<PromptDetail>(this.baseUrl, payload);
  }

  createVersion(promptId: string, payload: CreateVersionPayload): Observable<PromptDetail> {
    return this.http.post<PromptDetail>(`${this.baseUrl}/${promptId}/versions`, payload);
  }

  previewPrompt(payload: {
    templateBody: string;
    variables?: Record<string, string>;
    examples?: FewShotExample[];
  }): Observable<ResolvedPreview> {
    return this.http.post<ResolvedPreview>(`${this.baseUrl}/preview`, payload);
  }

  runPlayground(
    payload: {
      promptId?: string;
      versionNumber?: number;
      templateBody: string;
      variables?: Record<string, string>;
      examples?: FewShotExample[];
      model: string;
      temperature?: number;
      maxTokens?: number;
    },
    idempotencyKey?: string,
  ): Observable<PlaygroundRunResult> {
    const key = idempotencyKey || generateIdempotencyKey();
    const headers = new HttpHeaders({
      'Idempotency-Key': key,
    });
    return this.http
      .post<PlaygroundRunResult>(`${this.baseUrl}/run`, payload, { headers })
      .pipe(retryTransientErrors());
  }

  getModels(): Observable<{ models: ModelMetadata[]; gatewayConnected: boolean }> {
    return this.http.get<{ models: ModelMetadata[]; gatewayConnected: boolean }>(
      `${this.providersUrl}/models`,
    );
  }
}
