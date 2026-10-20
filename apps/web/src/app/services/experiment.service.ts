import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SlotConfigPayload {
  promptId?: string;
  promptVersionId?: string;
  versionNumber?: number;
  templateBody?: string;
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface EvaluationCriterion {
  id: string;
  name: string;
  type: 'contains_text' | 'regex' | 'json_validity' | 'max_length' | 'manual';
  expectedValue?: string;
}

export interface CriterionResult {
  criterionId: string;
  name: string;
  type: string;
  passed: boolean;
  notes?: string;
}

export interface SlotRunResult {
  slot: 'A' | 'B';
  promptId?: string;
  promptName?: string;
  promptVersionId?: string;
  versionNumber?: number;
  provider: string;
  model: string;
  resolvedPrompt: string;
  status: 'completed' | 'failed';
  output: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenUsageSource: 'provider-reported' | 'estimated';
  estimatedCost: number | null;
  errorCode: string | null;
  errorMessage?: string;
  configurationHint?: string;
  criteriaResults: CriterionResult[];
  manualRating?: number;
  manualNotes?: string;
}

export interface ComparisonResult {
  experimentId: string;
  name: string;
  createdAt: string;
  commonInput: Record<string, string>;
  slotA: SlotRunResult;
  slotB: SlotRunResult;
}

export interface RunComparisonPayload {
  name: string;
  commonInput: Record<string, string>;
  slotA: SlotConfigPayload;
  slotB: SlotConfigPayload;
  evaluationCriteria?: EvaluationCriterion[];
  saveExperiment?: boolean;
}

export interface SavedExperimentSummary {
  id: string;
  name: string;
  createdAt: string;
  commonInput: Record<string, string>;
  evaluationCriteria: EvaluationCriterion[];
  evaluations: Record<string, any>;
  runs: Array<{
    id: string;
    slot: 'A' | 'B';
    provider: string;
    model: string;
    output: string | null;
    status: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    tokenUsageSource: string;
    estimatedCost: number | null;
    errorCode: string | null;
    promptVersionId?: string;
    promptId?: string;
    promptName?: string;
    versionNumber?: number;
  }>;
}

@Injectable({
  providedIn: 'root',
})
export class ExperimentService {
  private readonly baseUrl = '/api/experiments';

  constructor(private readonly http: HttpClient) {}

  getExperiments(pagination?: { limit?: number; offset?: number }): Observable<SavedExperimentSummary[]> {
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
    return this.http.get<SavedExperimentSummary[]>(url);
  }

  getExperiment(id: string): Observable<SavedExperimentSummary> {
    return this.http.get<SavedExperimentSummary>(`${this.baseUrl}/${id}`);
  }

  runComparison(payload: RunComparisonPayload): Observable<ComparisonResult> {
    return this.http.post<ComparisonResult>(`${this.baseUrl}/run`, payload);
  }

  rateSlot(
    experimentId: string,
    slot: 'A' | 'B',
    rating: number,
    notes?: string,
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/${experimentId}/rate`, {
      slot,
      rating,
      notes,
    });
  }
}
