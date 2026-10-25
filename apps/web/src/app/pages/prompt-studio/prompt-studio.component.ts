import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  LucidePlus,
  LucideClock,
  LucideSearch,
  LucideCircleAlert,
  LucideFileText,
  LucideTriangleAlert,
  LucidePlay,
  LucideX,
} from '@lucide/angular';
import {
  PromptService,
  PromptSummary,
  PromptDetail,
  PromptVersionDetail,
  ModelMetadata,
  PlaygroundRunResult,
  ResolvedPreview,
  FewShotExample,
} from '../../services/prompt.service';
import { generateIdempotencyKey } from '../../utils/uuid.util';
import { isUnknownOutcomeError } from '../../utils/http-retry.util';

export type StudioViewMode = 'library' | 'editor';

@Component({
  selector: 'app-prompt-studio',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    LucidePlus,
    LucideClock,
    LucideSearch,
    LucideCircleAlert,
    LucideFileText,
    LucideTriangleAlert,
    LucidePlay,
    LucideX,
  ],
  templateUrl: './prompt-studio.component.html',
  styleUrls: ['./prompt-studio.component.css'],
})
export class PromptStudioComponent implements OnInit {
  // Navigation / View State
  viewMode = signal<StudioViewMode>('library');
  selectedPromptId = signal<string | null>(null);

  // Library State
  prompts = signal<PromptSummary[]>([]);
  loadingPrompts = signal<boolean>(false);
  promptsError = signal<string | null>(null);
  searchQuery = signal<string>('');
  selectedTechniqueFilter = signal<string>('all');

  availableTechniques: string[] = [
    'zero-shot',
    'one-shot',
    'few-shot',
    'RTF',
    'structured-output',
    'custom',
  ];

  // Models State
  availableModels = signal<ModelMetadata[]>([]);
  gatewayConnected = signal<boolean>(true);

  // Active Prompt / Editor State
  activePrompt = signal<PromptDetail | null>(null);
  selectedVersionNumber = signal<number>(1);
  loadingPrompt = signal<boolean>(false);
  savingVersion = signal<boolean>(false);

  // Form Fields
  promptName = '';
  promptDescription = '';
  selectedTechniques: string[] = ['zero-shot'];
  templateBody = '';
  variableValues: Record<string, string> = {};
  fewShotExamples: FewShotExample[] = [];
  selectedModel = 'gpt-4o-mini';
  temperature = 0.7;
  maxTokens = 1024;

  // Live Preview State
  preview = signal<ResolvedPreview | null>(null);

  // Playground Execution State
  runningPlayground = signal<boolean>(false);
  runResult = signal<PlaygroundRunResult | null>(null);
  runError = signal<string | null>(null);
  currentRunPlaygroundKey: string | null = null;

  // Version History Drawer
  showVersionHistory = signal<boolean>(false);

  // Computed detected variables from template body
  detectedVariables = computed(() => {
    const text = this.templateBody;
    const regex = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
    const matches = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.add(match[1]);
    }
    return Array.from(matches);
  });

  // Estimated template tokens
  estimatedTemplateTokens = computed(() => {
    const length = this.templateBody?.length || 0;
    return Math.max(1, Math.ceil(length / 4));
  });

  constructor(
    private readonly promptService: PromptService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.loadModels();
    this.loadPrompts();

    // Check query params if prompt ID specified
    this.route.queryParams.subscribe((params) => {
      if (params['id']) {
        this.openPromptEditor(params['id']);
      } else if (params['mode'] === 'new') {
        this.createNewPromptDraft();
      }
    });
  }

  loadModels(): void {
    this.promptService.getModels().subscribe({
      next: (res) => {
        const models = res.models || [];
        this.availableModels.set(models);
        this.gatewayConnected.set(res.gatewayConnected);
        if (models.length > 0) {
          if (!models.some((m) => m.id === this.selectedModel)) {
            this.selectedModel = models[0].id;
          }
        } else {
          this.selectedModel = '';
        }
      },
      error: () => {
        this.availableModels.set([]);
        this.gatewayConnected.set(false);
        this.selectedModel = '';
      },
    });
  }

  loadPrompts(): void {
    this.loadingPrompts.set(true);
    this.promptsError.set(null);

    this.promptService
      .getPrompts({
        search: this.searchQuery(),
        technique: this.selectedTechniqueFilter(),
      })
      .subscribe({
        next: (data) => {
          this.prompts.set(data);
          this.loadingPrompts.set(false);
        },
        error: (err) => {
          this.promptsError.set('Failed to load prompts from API. Please check backend connection.');
          this.loadingPrompts.set(false);
        },
      });
  }

  onSearchChange(): void {
    this.loadPrompts();
  }

  onTechniqueFilterChange(technique: string): void {
    this.selectedTechniqueFilter.set(technique);
    this.loadPrompts();
  }

  createNewPromptDraft(): void {
    this.loadingPrompt.set(false);
    this.viewMode.set('editor');
    this.selectedPromptId.set(null);
    this.activePrompt.set(null);
    this.selectedVersionNumber.set(1);

    this.promptName = 'New Prompt Template';
    this.promptDescription = 'Describe the purpose and expected behavior of this prompt template.';
    this.selectedTechniques = ['zero-shot'];
    this.templateBody = `Role: Assistant\nTask: Help the user with {{task_description}}.\nInput:\n{{user_input}}\n\nInstructions:\n- Provide a concise and accurate response.\n- Maintain a professional tone.`;
    this.variableValues = {
      task_description: 'summarizing technical requirements',
      user_input: 'Explain the difference between zero-shot and few-shot prompting.',
    };
    this.fewShotExamples = [];
    this.selectedModel = 'gpt-4o-mini';
    this.temperature = 0.7;
    this.maxTokens = 1024;
    this.runResult.set(null);
    this.runError.set(null);
    this.updatePreview();
  }

  openPromptEditor(promptId: string): void {
    this.viewMode.set('editor');
    this.selectedPromptId.set(promptId);
    this.activePrompt.set(null);
    this.promptName = '';
    this.promptDescription = '';
    this.templateBody = '';
    this.variableValues = {};
    this.fewShotExamples = [];
    this.loadingPrompt.set(true);
    this.runResult.set(null);
    this.runError.set(null);

    this.promptService.getPrompt(promptId).subscribe({
      next: (prompt) => {
        this.activePrompt.set(prompt);
        this.promptName = prompt.name;
        this.promptDescription = prompt.description || '';
        this.selectedTechniques = prompt.techniques.length > 0 ? [...prompt.techniques] : ['zero-shot'];

        // Load latest version
        if (prompt.versions.length > 0) {
          this.loadVersion(prompt.versions[0].versionNumber);
        }

        this.loadingPrompt.set(false);
      },
      error: (err) => {
        this.runError.set(`Failed to load prompt ${promptId}`);
        this.loadingPrompt.set(false);
      },
    });
  }

  loadVersion(versionNumber: number): void {
    const prompt = this.activePrompt();
    if (!prompt) return;

    const version = prompt.versions.find((v) => v.versionNumber === versionNumber);
    if (!version) return;

    this.selectedVersionNumber.set(versionNumber);
    this.templateBody = version.templateBody;
    this.fewShotExamples = version.examples ? JSON.parse(JSON.stringify(version.examples)) : [];

    // Populate variable sample values from existing declarations or defaults
    const newValues: Record<string, string> = {};
    if (version.variables && version.variables.length > 0) {
      for (const v of version.variables) {
        newValues[v.name] = v.defaultValue || this.variableValues[v.name] || '';
      }
    }
    this.variableValues = newValues;

    if (version.modelDefaults?.model) {
      this.selectedModel = version.modelDefaults.model;
    }
    if (version.modelDefaults?.temperature !== undefined) {
      this.temperature = version.modelDefaults.temperature;
    }
    if (version.modelDefaults?.maxTokens !== undefined) {
      this.maxTokens = version.modelDefaults.maxTokens;
    }

    this.updatePreview();
  }

  toggleTechnique(technique: string): void {
    const idx = this.selectedTechniques.indexOf(technique);
    if (idx >= 0) {
      if (this.selectedTechniques.length > 1) {
        this.selectedTechniques.splice(idx, 1);
      }
    } else {
      this.selectedTechniques.push(technique);
    }
  }

  isTechniqueSelected(technique: string): boolean {
    return this.selectedTechniques.includes(technique);
  }

  addFewShotExample(): void {
    this.fewShotExamples.push({ input: '', output: '' });
    if (!this.selectedTechniques.includes('few-shot')) {
      this.selectedTechniques.push('few-shot');
    }
    this.updatePreview();
  }

  removeFewShotExample(index: number): void {
    this.fewShotExamples.splice(index, 1);
    this.updatePreview();
  }

  onTemplateChange(): void {
    this.currentRunPlaygroundKey = null;
    // Ensure all detected variables have an entry in variableValues
    for (const v of this.detectedVariables()) {
      if (this.variableValues[v] === undefined) {
        this.variableValues[v] = '';
      }
    }
    this.updatePreview();
  }

  onVariableValueChange(): void {
    this.currentRunPlaygroundKey = null;
    this.updatePreview();
  }

  updatePreview(): void {
    this.promptService
      .previewPrompt({
        templateBody: this.templateBody,
        variables: this.variableValues,
        examples: this.fewShotExamples.filter((e) => e.input && e.output),
      })
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
        },
        error: (err) => {
          console.warn('Preview generation failed:', err);
        },
      });
  }

  saveAsNewVersion(): void {
    if (!this.promptName.trim()) {
      alert('Prompt Name is required.');
      return;
    }
    if (!this.templateBody.trim()) {
      alert('Template Body cannot be empty.');
      return;
    }

    this.savingVersion.set(true);
    const promptId = this.selectedPromptId();

    const variablesPayload = this.detectedVariables().map((name) => ({
      name,
      required: true,
      defaultValue: this.variableValues[name] || '',
    }));

    const modelDefaults = {
      model: this.selectedModel,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    };

    if (promptId) {
      // Append new version (v+1)
      this.promptService
        .createVersion(promptId, {
          name: this.promptName,
          description: this.promptDescription,
          techniques: this.selectedTechniques,
          templateBody: this.templateBody,
          variables: variablesPayload,
          examples: this.fewShotExamples,
          modelDefaults,
        })
        .subscribe({
          next: (updatedPrompt) => {
            this.activePrompt.set(updatedPrompt);
            this.selectedVersionNumber.set(updatedPrompt.versions[0].versionNumber);
            this.savingVersion.set(false);
            this.loadPrompts();
          },
          error: (err) => {
            alert('Failed to save version: ' + (err.error?.message || err.message));
            this.savingVersion.set(false);
          },
        });
    } else {
      // Create new prompt + v1
      this.promptService
        .createPrompt({
          name: this.promptName,
          description: this.promptDescription,
          techniques: this.selectedTechniques,
          templateBody: this.templateBody,
          variables: variablesPayload,
          examples: this.fewShotExamples,
          modelDefaults,
        })
        .subscribe({
          next: (createdPrompt) => {
            this.activePrompt.set(createdPrompt);
            this.selectedPromptId.set(createdPrompt.id);
            this.selectedVersionNumber.set(1);
            this.savingVersion.set(false);
            this.loadPrompts();
          },
          error: (err) => {
            alert('Failed to create prompt: ' + (err.error?.message || err.message));
            this.savingVersion.set(false);
          },
        });
    }
  }

  runPlayground(): void {
    // Validate required variables
    const missing: string[] = [];
    for (const v of this.detectedVariables()) {
      if (!this.variableValues[v] || !this.variableValues[v].trim()) {
        missing.push(v);
      }
    }

    if (!this.selectedModel) {
      this.runError.set('No model selected or available. Verify that LiteLLM gateway is running and models are configured in config.yaml.');
      return;
    }

    if (missing.length > 0) {
      this.runError.set(`Missing required variable(s): ${missing.join(', ')}. Please provide sample values above.`);
      return;
    }

    this.runError.set(null);
    this.runningPlayground.set(true);

    if (!this.currentRunPlaygroundKey) {
      this.currentRunPlaygroundKey = generateIdempotencyKey();
    }
    const key = this.currentRunPlaygroundKey;

    this.promptService
      .runPlayground(
        {
          promptId: this.selectedPromptId() || undefined,
          versionNumber: this.selectedVersionNumber(),
          templateBody: this.templateBody,
          variables: this.variableValues,
          examples: this.fewShotExamples.filter((e) => e.input && e.output),
          model: this.selectedModel,
          temperature: this.temperature,
          maxTokens: this.maxTokens,
        },
        key,
      )
      .subscribe({
        next: (res) => {
          this.runResult.set(res);
          this.runningPlayground.set(false);
          if (res.success) {
            this.currentRunPlaygroundKey = null; // Cleared on successful execution
          } else if (res.errorMessage) {
            this.runError.set(res.errorMessage);
          }
        },
        error: (err) => {
          this.runningPlayground.set(false);
          this.runError.set(err.error?.message || 'Execution failed while communicating with the gateway.');
          if (!isUnknownOutcomeError(err)) {
            this.currentRunPlaygroundKey = null;
          }
        },
      });
  }

  backToLibrary(): void {
    this.loadingPrompt.set(false);
    this.viewMode.set('library');
    this.selectedPromptId.set(null);
    this.activePrompt.set(null);
    this.loadPrompts();
  }

  toggleVersionHistory(): void {
    this.showVersionHistory.set(!this.showVersionHistory());
  }
}
