import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CompareComponent } from './compare.component';
import {
  ExperimentService,
  ComparisonResult,
  SavedExperimentSummary,
} from '../../services/experiment.service';
import { PromptService } from '../../services/prompt.service';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

describe('CompareComponent', () => {
  let component: CompareComponent;
  let fixture: ComponentFixture<CompareComponent>;
  let mockExperimentService: jasmine.SpyObj<ExperimentService>;
  let mockPromptService: jasmine.SpyObj<PromptService>;

  const mockPrompts = [
    {
      id: 'p-1',
      name: 'Customer Classifier A',
      description: 'Zero shot classifier',
      techniques: ['zero-shot'],
      versionCount: 2,
      latestVersionNumber: 2,
      latestTemplateBody: 'Classify message: {{message}}',
      createdAt: '2026-10-19T00:00:00Z',
      updatedAt: '2026-10-19T00:00:00Z',
      owner: { id: 'u-1', displayName: 'Dev', email: 'dev@test.com' },
    },
    {
      id: 'p-2',
      name: 'Customer Classifier B (Few Shot)',
      description: 'Few shot classifier',
      techniques: ['few-shot'],
      versionCount: 1,
      latestVersionNumber: 1,
      latestTemplateBody: 'Classify with examples: {{message}}',
      createdAt: '2026-10-19T00:00:00Z',
      updatedAt: '2026-10-19T00:00:00Z',
      owner: { id: 'u-1', displayName: 'Dev', email: 'dev@test.com' },
    },
  ];

  const mockDetailP1 = {
    ...mockPrompts[0],
    versions: [
      {
        id: 'v-1',
        versionNumber: 1,
        templateBody: 'Simple classify: {{message}}',
        variables: [{ name: 'message', defaultValue: 'Help with my login' }],
        techniques: ['zero-shot'],
        modelConfig: { model: 'gpt-4o-mini', provider: 'openai', temperature: 0.7, maxTokens: 1024 },
        changeDescription: 'Initial',
        createdAt: '2026-10-19T00:00:00Z',
        author: { id: 'u-1', displayName: 'Dev', email: 'dev@test.com' },
      },
      {
        id: 'v-2',
        versionNumber: 2,
        templateBody: 'Classify message: {{message}}',
        variables: [{ name: 'message', defaultValue: 'Billing issue' }],
        techniques: ['zero-shot'],
        modelConfig: { model: 'gpt-4o-mini', provider: 'openai', temperature: 0.5, maxTokens: 1024 },
        changeDescription: 'Updated prompt',
        createdAt: '2026-10-19T01:00:00Z',
        author: { id: 'u-1', displayName: 'Dev', email: 'dev@test.com' },
      },
    ],
  };

  const mockDetailP2 = {
    ...mockPrompts[1],
    versions: [
      {
        id: 'v-3',
        versionNumber: 1,
        templateBody: 'Classify with examples: {{message}}',
        variables: [{ name: 'message', defaultValue: 'Refund request' }],
        techniques: ['few-shot'],
        modelConfig: { model: 'claude-3-5-sonnet', provider: 'anthropic', temperature: 0.2, maxTokens: 512 },
        changeDescription: 'Initial',
        createdAt: '2026-10-19T00:00:00Z',
        author: { id: 'u-1', displayName: 'Dev', email: 'dev@test.com' },
      },
    ],
  };

  const mockSuccessComparisonResult: ComparisonResult = {
    experimentId: 'exp-123',
    name: 'Classification Comparison',
    createdAt: '2026-10-19T00:00:00Z',
    commonInput: { message: 'I need a refund for my order #123' },
    slotA: {
      slot: 'A',
      promptId: 'p-1',
      promptName: 'Customer Classifier A',
      promptVersionId: 'v-2',
      versionNumber: 2,
      provider: 'openai',
      model: 'gpt-4o-mini',
      resolvedPrompt: 'Classify message: I need a refund for my order #123',
      status: 'completed',
      output: 'Category: Billing & Refunds',
      latencyMs: 342,
      inputTokens: 18,
      outputTokens: 6,
      totalTokens: 24,
      tokenUsageSource: 'provider-reported',
      estimatedCost: 0.0000063,
      errorCode: null,
      criteriaResults: [
        {
          criterionId: 'crit-2',
          name: 'Valid JSON Output',
          type: 'json_validity',
          passed: false,
          notes: 'Output does not match valid JSON object syntax',
        },
      ],
    },
    slotB: {
      slot: 'B',
      promptId: 'p-2',
      promptName: 'Customer Classifier B (Few Shot)',
      promptVersionId: 'v-3',
      versionNumber: 1,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      resolvedPrompt: 'Classify with examples: I need a refund for my order #123',
      status: 'completed',
      output: '{"category": "Billing & Refunds", "confidence": 0.98}',
      latencyMs: 512,
      inputTokens: 32,
      outputTokens: 14,
      totalTokens: 46,
      tokenUsageSource: 'provider-reported',
      estimatedCost: 0.000306,
      errorCode: null,
      criteriaResults: [
        {
          criterionId: 'crit-2',
          name: 'Valid JSON Output',
          type: 'json_validity',
          passed: true,
          notes: 'Output parsed successfully as JSON',
        },
      ],
    },
  };

  beforeEach(async () => {
    mockExperimentService = jasmine.createSpyObj('ExperimentService', [
      'runComparison',
      'getExperiments',
      'getExperiment',
      'rateSlot',
    ]);
    mockPromptService = jasmine.createSpyObj('PromptService', [
      'getPrompts',
      'getPrompt',
      'getModels',
    ]);

    mockPromptService.getPrompts.and.returnValue(of(mockPrompts));
    mockPromptService.getModels.and.returnValue(
      of({
        models: [
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
          { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
        ],
        gatewayConnected: true,
      }),
    );
    mockPromptService.getPrompt.and.callFake((id: string) => {
      if (id === 'p-1') return of(mockDetailP1 as any);
      if (id === 'p-2') return of(mockDetailP2 as any);
      return throwError(() => new Error('Prompt not found'));
    });

    const mockSavedExp: SavedExperimentSummary = {
      id: 'exp-123',
      name: 'Classification Comparison',
      createdAt: '2026-10-19T00:00:00Z',
      commonInput: { message: 'I need a refund for my order #123' },
      evaluationCriteria: [
        { id: 'crit-2', name: 'Valid JSON Output', type: 'json_validity' },
      ],
      evaluations: {
        A: { manualRating: 4, manualNotes: 'Good result' },
        B: { manualRating: 5, manualNotes: 'Excellent JSON' },
      },
      runs: [
        {
          id: 'run-1',
          slot: 'A',
          provider: 'openai',
          model: 'gpt-4o-mini',
          output: 'Category: Billing & Refunds',
          status: 'completed',
          latencyMs: 342,
          inputTokens: 18,
          outputTokens: 6,
          tokenUsageSource: 'provider-reported',
          estimatedCost: 0.0000063,
          errorCode: null,
          promptId: 'p-1',
          promptName: 'Customer Classifier A',
          versionNumber: 2,
        },
        {
          id: 'run-2',
          slot: 'B',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          output: '{"category": "Billing & Refunds"}',
          status: 'completed',
          latencyMs: 512,
          inputTokens: 32,
          outputTokens: 14,
          tokenUsageSource: 'provider-reported',
          estimatedCost: 0.000306,
          errorCode: null,
          promptId: 'p-2',
          promptName: 'Customer Classifier B (Few Shot)',
          versionNumber: 1,
        },
      ],
    };

    mockExperimentService.getExperiments.and.returnValue(of([mockSavedExp]));
    mockExperimentService.getExperiment.and.returnValue(of(mockSavedExp));
    mockExperimentService.runComparison.and.returnValue(of(mockSuccessComparisonResult));
    mockExperimentService.rateSlot.and.returnValue(of({ success: true }));

    await TestBed.configureTestingModule({
      imports: [CompareComponent],
      providers: [
        provideRouter([]),
        { provide: ExperimentService, useValue: mockExperimentService },
        { provide: PromptService, useValue: mockPromptService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CompareComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load initial prompts and models', () => {
    expect(component).toBeTruthy();
    expect(mockPromptService.getPrompts).toHaveBeenCalled();
    expect(mockPromptService.getModels).toHaveBeenCalled();
    expect(component.prompts().length).toBe(2);
    expect(component.availableModels().length).toBe(2);
  });

  it('should select prompt and version for Slot A and Slot B correctly', () => {
    component.onSlotAPromptChange('p-1');
    expect(component.slotAPromptId).toBe('p-1');
    expect(component.slotAVersionId).toBe('v-1');

    component.onSlotBPromptChange('p-2');
    expect(component.slotBPromptId).toBe('p-2');
    expect(component.slotBVersionId).toBe('v-3');
  });

  it('should sync settings between slots when syncSettings is true', () => {
    component.syncSettings.set(true);

    component.onSlotAModelChange('claude-3-5-sonnet');
    expect(component.slotAModel).toBe('claude-3-5-sonnet');
    expect(component.slotBModel).toBe('claude-3-5-sonnet');
    expect(component.slotBProvider).toBe('anthropic');

    component.slotATemperature = 0.2;
    component.onSlotATemperatureChange();
    expect(component.slotBTemperature).toBe(0.2);

    component.slotAMaxTokens = 500;
    component.onSlotAMaxTokensChange();
    expect(component.slotBMaxTokens).toBe(500);
  });

  it('should not sync settings when syncSettings is false', () => {
    component.syncSettings.set(false);
    component.slotBModel = 'gpt-4o-mini';
    component.slotBTemperature = 0.7;

    component.onSlotAModelChange('claude-3-5-sonnet');
    expect(component.slotAModel).toBe('claude-3-5-sonnet');
    expect(component.slotBModel).toBe('gpt-4o-mini');

    component.slotATemperature = 0.1;
    component.onSlotATemperatureChange();
    expect(component.slotBTemperature).toBe(0.7);
  });

  it('should extract common input variables from selected prompt templates', () => {
    component.onSlotAPromptChange('p-1');
    component.onSlotBPromptChange('p-2');

    expect(component.detectedVariables().includes('message')).toBeTrue();
  });

  it('should add and remove evaluation criteria correctly', () => {
    const initialCount = component.evaluationCriteria.length;
    component.addEvaluationCriterion();
    expect(component.evaluationCriteria.length).toBe(initialCount + 1);

    component.removeEvaluationCriterion(initialCount);
    expect(component.evaluationCriteria.length).toBe(initialCount);
  });

  it('should run comparison and display side-by-side results with criteria pass/fail status', () => {
    component.onSlotAPromptChange('p-1');
    component.onSlotBPromptChange('p-2');
    component.commonInput['message'] = 'I need a refund for my order #123';

    component.runComparison();

    expect(mockExperimentService.runComparison).toHaveBeenCalled();
    const result = component.comparisonResult();
    expect(result).not.toBeNull();
    expect(result?.slotA.output).toBe('Category: Billing & Refunds');
    expect(result?.slotB.output).toBe('{"category": "Billing & Refunds", "confidence": 0.98}');
    expect(result?.slotA.latencyMs).toBe(342);
    expect(result?.slotB.latencyMs).toBe(512);
    expect(result?.slotA.criteriaResults?.[0].passed).toBeFalse();
    expect(result?.slotB.criteriaResults?.[0].passed).toBeTrue();
  });

  it('should handle partial failure gracefully where Slot A fails and Slot B succeeds', () => {
    const partialFailureResult: ComparisonResult = {
      experimentId: 'exp-partial',
      name: 'Partial Failure Test',
      createdAt: '2026-10-19T00:00:00Z',
      commonInput: { message: 'test' },
      slotA: {
        slot: 'A',
        promptId: 'p-1',
        promptName: 'Customer Classifier A',
        promptVersionId: 'v-2',
        versionNumber: 2,
        provider: 'openai',
        model: 'invalid-model',
        resolvedPrompt: 'Classify message: test',
        status: 'failed',
        output: null,
        latencyMs: 120,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        tokenUsageSource: 'provider-reported',
        estimatedCost: null,
        errorCode: 'PROVIDER_AUTH_ERROR: Invalid model specified',
        criteriaResults: [],
      },
      slotB: {
        slot: 'B',
        promptId: 'p-2',
        promptName: 'Customer Classifier B (Few Shot)',
        promptVersionId: 'v-3',
        versionNumber: 1,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        resolvedPrompt: 'Classify with examples: test',
        status: 'completed',
        output: 'Classification result B',
        latencyMs: 380,
        inputTokens: 20,
        outputTokens: 8,
        totalTokens: 28,
        tokenUsageSource: 'provider-reported',
        estimatedCost: 0.00018,
        errorCode: null,
        criteriaResults: [],
      },
    };

    mockExperimentService.runComparison.and.returnValue(of(partialFailureResult));

    component.onSlotAPromptChange('p-1');
    component.onSlotBPromptChange('p-2');
    component.commonInput['message'] = 'test';
    component.runComparison();

    const result = component.comparisonResult();
    expect(result).not.toBeNull();
    expect(result?.slotA.status).toBe('failed');
    expect(result?.slotA.errorCode).toContain('PROVIDER_AUTH_ERROR');
    expect(result?.slotB.status).toBe('completed');
    expect(result?.slotB.output).toBe('Classification result B');
  });

  it('should allow submitting manual ratings and notes for each slot', () => {
    component.onSlotAPromptChange('p-1');
    component.onSlotBPromptChange('p-2');
    component.commonInput['message'] = 'test';
    component.runComparison();

    component.rateSlot('A', 4);
    expect(mockExperimentService.rateSlot).toHaveBeenCalledWith('exp-123', 'A', 4, '');

    component.slotBNotes = 'Excellent structured output';
    component.rateSlot('B', 5);
    expect(mockExperimentService.rateSlot).toHaveBeenCalledWith('exp-123', 'B', 5, 'Excellent structured output');
  });

  it('should toggle history drawer and view past experiments', () => {
    expect(component.showHistoryDrawer()).toBeFalse();
    component.toggleHistoryDrawer();
    expect(component.showHistoryDrawer()).toBeTrue();
    expect(mockExperimentService.getExperiments).toHaveBeenCalled();

    component.loadSavedExperiment('exp-123');
    expect(mockExperimentService.getExperiment).toHaveBeenCalledWith('exp-123');
    expect(component.showHistoryDrawer()).toBeFalse();
    expect(component.slotARating).toBe(4);
    expect(component.slotBRating).toBe(5);
  });
});
