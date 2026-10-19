import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  ExperimentService,
  ComparisonResult,
  SavedExperimentSummary,
  EvaluationCriterion,
  SlotRunResult,
} from '../../services/experiment.service';
import {
  PromptService,
  PromptSummary,
  PromptDetail,
  ModelMetadata,
} from '../../services/prompt.service';

@Component({
  selector: 'app-compare',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './compare.component.html',
  styleUrls: ['./compare.component.css'],
})
export class CompareComponent implements OnInit {
  // Inventory
  prompts = signal<PromptSummary[]>([]);
  availableModels = signal<ModelMetadata[]>([]);
  promptDetailsMap = new Map<string, PromptDetail>();

  // Experiments History
  savedExperiments = signal<SavedExperimentSummary[]>([]);
  loadingHistory = signal<boolean>(false);
  showHistoryDrawer = signal<boolean>(false);

  // Active Experiment Configuration
  experimentName = 'Prompt Comparison Experiment';
  syncSettings = signal<boolean>(true);

  // Slot A Configuration
  slotAPromptId = '';
  slotAVersionId = '';
  slotAVersionNumber = 1;
  slotATemplateBody = '';
  slotAModel = 'gpt-4o-mini';
  slotAProvider = 'openai';
  slotATemperature = 0.7;
  slotAMaxTokens = 1024;

  // Slot B Configuration
  slotBPromptId = '';
  slotBVersionId = '';
  slotBVersionNumber = 1;
  slotBTemplateBody = '';
  slotBModel = 'gpt-4o-mini';
  slotBProvider = 'openai';
  slotBTemperature = 0.7;
  slotBMaxTokens = 1024;

  // Common Input Variables
  commonInput: Record<string, string> = {};

  // Configurable Repeatable Evaluation Criteria
  evaluationCriteria: EvaluationCriterion[] = [
    { id: 'crit-1', name: 'Contains Expected Keyword', type: 'contains_text', expectedValue: '' },
    { id: 'crit-2', name: 'Valid JSON Output', type: 'json_validity' },
  ];

  // Execution & Output State
  runningComparison = signal<boolean>(false);
  comparisonResult = signal<ComparisonResult | null>(null);
  runError = signal<string | null>(null);

  // Manual Ratings & Feedback
  slotARating = 0;
  slotANotes = '';
  slotBRating = 0;
  slotBNotes = '';

  // Detected unique variables across both templates
  detectedVariables = computed(() => {
    const textA = this.slotATemplateBody || '';
    const textB = this.slotBTemplateBody || '';
    const regex = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
    const matches = new Set<string>();

    let m: RegExpExecArray | null;
    while ((m = regex.exec(textA)) !== null) {
      matches.add(m[1]);
    }
    while ((m = regex.exec(textB)) !== null) {
      matches.add(m[1]);
    }

    return Array.from(matches);
  });

  constructor(
    private readonly experimentService: ExperimentService,
    private readonly promptService: PromptService,
  ) {}

  ngOnInit(): void {
    this.loadModelsAndPrompts();
    this.loadHistory();
  }

  loadModelsAndPrompts(): void {
    this.promptService.getModels().subscribe({
      next: (res) => {
        const models = res.models || [];
        this.availableModels.set(models);
        if (models.length > 0) {
          this.slotAModel = models[0].id;
          this.slotAProvider = models[0].provider;
          this.slotBModel = models.length > 1 ? models[1].id : models[0].id;
          this.slotBProvider = models.length > 1 ? models[1].provider : models[0].provider;
        }
      },
    });

    this.promptService.getPrompts().subscribe({
      next: (prompts) => {
        this.prompts.set(prompts);
        if (prompts.length > 0) {
          // Initialize Slot A with first prompt
          this.onSlotAPromptChange(prompts[0].id);
          // Initialize Slot B with first prompt (or second if available)
          const promptBId = prompts.length > 1 ? prompts[1].id : prompts[0].id;
          this.onSlotBPromptChange(promptBId);
        }
      },
    });
  }

  loadHistory(): void {
    this.loadingHistory.set(true);
    this.experimentService.getExperiments().subscribe({
      next: (list) => {
        this.savedExperiments.set(list);
        this.loadingHistory.set(false);
      },
      error: () => {
        this.loadingHistory.set(false);
      },
    });
  }

  onSlotAPromptChange(promptId: string): void {
    this.slotAPromptId = promptId;
    this.promptService.getPrompt(promptId).subscribe({
      next: (prompt) => {
        this.promptDetailsMap.set(promptId, prompt);
        if (prompt.versions.length > 0) {
          const v = prompt.versions[0];
          this.slotAVersionId = v.id;
          this.slotAVersionNumber = v.versionNumber;
          this.slotATemplateBody = v.templateBody;
          this.updateVariableDefaults(v);
        }
      },
    });
  }

  onSlotBPromptChange(promptId: string): void {
    this.slotBPromptId = promptId;
    this.promptService.getPrompt(promptId).subscribe({
      next: (prompt) => {
        this.promptDetailsMap.set(promptId, prompt);
        if (prompt.versions.length > 0) {
          // If comparing same prompt, pick version 2 if exists, or version 1
          const v =
            promptId === this.slotAPromptId && prompt.versions.length > 1
              ? prompt.versions[1]
              : prompt.versions[0];

          this.slotBVersionId = v.id;
          this.slotBVersionNumber = v.versionNumber;
          this.slotBTemplateBody = v.templateBody;
          this.updateVariableDefaults(v);
        }
      },
    });
  }

  onSlotAVersionChange(versionId: string): void {
    const prompt = this.promptDetailsMap.get(this.slotAPromptId);
    if (!prompt) return;
    const v = prompt.versions.find((x) => x.id === versionId);
    if (v) {
      this.slotAVersionId = v.id;
      this.slotAVersionNumber = v.versionNumber;
      this.slotATemplateBody = v.templateBody;
      this.updateVariableDefaults(v);
    }
  }

  onSlotBVersionChange(versionId: string): void {
    const prompt = this.promptDetailsMap.get(this.slotBPromptId);
    if (!prompt) return;
    const v = prompt.versions.find((x) => x.id === versionId);
    if (v) {
      this.slotBVersionId = v.id;
      this.slotBVersionNumber = v.versionNumber;
      this.slotBTemplateBody = v.templateBody;
      this.updateVariableDefaults(v);
    }
  }

  onSlotAModelChange(modelId: string): void {
    this.slotAModel = modelId;
    const m = this.availableModels().find((x) => x.id === modelId);
    if (m) this.slotAProvider = m.provider;

    if (this.syncSettings()) {
      this.slotBModel = this.slotAModel;
      this.slotBProvider = this.slotAProvider;
    }
  }

  onSlotBModelChange(modelId: string): void {
    this.slotBModel = modelId;
    const m = this.availableModels().find((x) => x.id === modelId);
    if (m) this.slotBProvider = m.provider;
  }

  onSlotATemperatureChange(): void {
    if (this.syncSettings()) {
      this.slotBTemperature = this.slotATemperature;
    }
  }

  onSlotAMaxTokensChange(): void {
    if (this.syncSettings()) {
      this.slotBMaxTokens = this.slotAMaxTokens;
    }
  }

  private updateVariableDefaults(version: any): void {
    if (version.variables && Array.isArray(version.variables)) {
      for (const v of version.variables) {
        if (!this.commonInput[v.name] && v.defaultValue) {
          this.commonInput[v.name] = v.defaultValue;
        }
      }
    }
  }

  addEvaluationCriterion(): void {
    const nextId = 'crit-' + (this.evaluationCriteria.length + 1);
    this.evaluationCriteria.push({
      id: nextId,
      name: 'Custom Evaluation Criterion',
      type: 'contains_text',
      expectedValue: '',
    });
  }

  removeEvaluationCriterion(index: number): void {
    this.evaluationCriteria.splice(index, 1);
  }

  runComparison(): void {
    this.runError.set(null);

    // Validate variables
    const missing: string[] = [];
    for (const v of this.detectedVariables()) {
      if (!this.commonInput[v] || !this.commonInput[v].trim()) {
        missing.push(v);
      }
    }

    if (missing.length > 0) {
      this.runError.set(`Missing common input variable(s): ${missing.join(', ')}. Please fill test values above.`);
      return;
    }

    this.runningComparison.set(true);

    this.experimentService
      .runComparison({
        name: this.experimentName || 'Side-by-Side Comparison',
        commonInput: this.commonInput,
        slotA: {
          promptId: this.slotAPromptId,
          promptVersionId: this.slotAVersionId,
          versionNumber: this.slotAVersionNumber,
          templateBody: this.slotATemplateBody,
          provider: this.slotAProvider,
          model: this.slotAModel,
          temperature: this.slotATemperature,
          maxTokens: this.slotAMaxTokens,
        },
        slotB: {
          promptId: this.slotBPromptId,
          promptVersionId: this.slotBVersionId,
          versionNumber: this.slotBVersionNumber,
          templateBody: this.slotBTemplateBody,
          provider: this.slotBProvider,
          model: this.slotBModel,
          temperature: this.slotBTemperature,
          maxTokens: this.slotBMaxTokens,
        },
        evaluationCriteria: this.evaluationCriteria.filter((c) => c.name.trim().length > 0),
        saveExperiment: true,
      })
      .subscribe({
        next: (res) => {
          this.comparisonResult.set(res);
          this.runningComparison.set(false);
          this.slotARating = 0;
          this.slotANotes = '';
          this.slotBRating = 0;
          this.slotBNotes = '';
          this.loadHistory();
        },
        error: (err) => {
          this.runningComparison.set(false);
          this.runError.set(err.error?.message || 'Comparison execution failed.');
        },
      });
  }

  rateSlot(slot: 'A' | 'B', rating: number): void {
    const res = this.comparisonResult();
    if (!res) return;

    if (slot === 'A') {
      this.slotARating = rating;
    } else {
      this.slotBRating = rating;
    }

    const notes = slot === 'A' ? this.slotANotes : this.slotBNotes;

    this.experimentService.rateSlot(res.experimentId, slot, rating, notes).subscribe({
      next: () => {
        // Updated rating recorded in experiment settings
      },
    });
  }

  saveSlotNotes(slot: 'A' | 'B'): void {
    const res = this.comparisonResult();
    if (!res) return;
    const rating = slot === 'A' ? this.slotARating : this.slotBRating;
    const notes = slot === 'A' ? this.slotANotes : this.slotBNotes;

    this.experimentService.rateSlot(res.experimentId, slot, rating || 3, notes).subscribe();
  }

  loadSavedExperiment(expId: string): void {
    this.experimentService.getExperiment(expId).subscribe({
      next: (exp) => {
        this.experimentName = exp.name;
        this.commonInput = exp.commonInput || {};
        this.evaluationCriteria = exp.evaluationCriteria || [];

        const runA = exp.runs.find((r) => r.slot === 'A');
        const runB = exp.runs.find((r) => r.slot === 'B');

        const mockRes: ComparisonResult = {
          experimentId: exp.id,
          name: exp.name,
          createdAt: exp.createdAt,
          commonInput: exp.commonInput,
          slotA: {
            slot: 'A',
            promptId: runA?.promptId,
            promptName: runA?.promptName,
            promptVersionId: runA?.promptVersionId,
            versionNumber: runA?.versionNumber,
            provider: runA?.provider || 'openai',
            model: runA?.model || 'gpt-4o-mini',
            resolvedPrompt: '',
            status: (runA?.status as any) || 'completed',
            output: runA?.output || null,
            latencyMs: runA?.latencyMs || 0,
            inputTokens: runA?.inputTokens || 0,
            outputTokens: runA?.outputTokens || 0,
            totalTokens: (runA?.inputTokens || 0) + (runA?.outputTokens || 0),
            tokenUsageSource: (runA?.tokenUsageSource as any) || 'provider-reported',
            estimatedCost: runA?.estimatedCost || null,
            errorCode: runA?.errorCode || null,
            criteriaResults: exp.evaluations?.['A']?.criteriaResults || [],
            manualRating: exp.evaluations?.['A']?.manualRating,
            manualNotes: exp.evaluations?.['A']?.manualNotes,
          },
          slotB: {
            slot: 'B',
            promptId: runB?.promptId,
            promptName: runB?.promptName,
            promptVersionId: runB?.promptVersionId,
            versionNumber: runB?.versionNumber,
            provider: runB?.provider || 'openai',
            model: runB?.model || 'gpt-4o-mini',
            resolvedPrompt: '',
            status: (runB?.status as any) || 'completed',
            output: runB?.output || null,
            latencyMs: runB?.latencyMs || 0,
            inputTokens: runB?.inputTokens || 0,
            outputTokens: runB?.outputTokens || 0,
            totalTokens: (runB?.inputTokens || 0) + (runB?.outputTokens || 0),
            tokenUsageSource: (runB?.tokenUsageSource as any) || 'provider-reported',
            estimatedCost: runB?.estimatedCost || null,
            errorCode: runB?.errorCode || null,
            criteriaResults: exp.evaluations?.['B']?.criteriaResults || [],
            manualRating: exp.evaluations?.['B']?.manualRating,
            manualNotes: exp.evaluations?.['B']?.manualNotes,
          },
        };

        this.comparisonResult.set(mockRes);
        this.slotARating = exp.evaluations?.['A']?.manualRating || 0;
        this.slotANotes = exp.evaluations?.['A']?.manualNotes || '';
        this.slotBRating = exp.evaluations?.['B']?.manualRating || 0;
        this.slotBNotes = exp.evaluations?.['B']?.manualNotes || '';

        this.showHistoryDrawer.set(false);
      },
    });
  }

  toggleHistoryDrawer(): void {
    this.showHistoryDrawer.set(!this.showHistoryDrawer());
  }

  getPromptVersions(promptId: string): any[] {
    const prompt = this.promptDetailsMap.get(promptId);
    return prompt?.versions || [];
  }
}
