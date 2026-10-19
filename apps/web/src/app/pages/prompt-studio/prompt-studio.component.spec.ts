import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PromptStudioComponent } from './prompt-studio.component';
import { PromptService } from '../../services/prompt.service';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

describe('PromptStudioComponent', () => {
  let component: PromptStudioComponent;
  let fixture: ComponentFixture<PromptStudioComponent>;
  let mockPromptService: jasmine.SpyObj<PromptService>;

  beforeEach(async () => {
    mockPromptService = jasmine.createSpyObj('PromptService', [
      'getModels',
      'getPrompts',
      'getPrompt',
      'createPrompt',
      'createVersion',
      'previewPrompt',
      'runPlayground',
    ]);

    mockPromptService.getModels.and.returnValue(
      of({
        models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' }],
        gatewayConnected: true,
      }),
    );

    mockPromptService.getPrompts.and.returnValue(
      of([
        {
          id: 'p-1',
          name: 'Customer Support Classifier',
          description: 'Classifies customer queries',
          techniques: ['zero-shot', 'structured-output'],
          versionCount: 2,
          latestVersionNumber: 2,
          latestTemplateBody: 'Classify: {{query}}',
          createdAt: '2026-10-19T00:00:00Z',
          updatedAt: '2026-10-19T00:00:00Z',
          owner: { id: 'u-1', displayName: 'Dev', email: 'dev@test.com' },
        },
      ]),
    );

    mockPromptService.getPrompt.and.returnValue(
      of({
        id: 'p-1',
        name: 'Customer Support Classifier',
        description: 'Classifies customer queries',
        techniques: ['zero-shot', 'structured-output'],
        createdAt: '2026-10-19T00:00:00Z',
        updatedAt: '2026-10-19T00:00:00Z',
        owner: { id: 'u-1', displayName: 'Dev', email: 'dev@test.com' },
        versions: [
          {
            id: 'v-2',
            versionNumber: 2,
            templateBody: 'Classify: {{query}} into {{category}}',
            variables: [
              { name: 'query', defaultValue: 'Test query' },
              { name: 'category', defaultValue: 'Billing' },
            ],
            examples: [],
            outputSchema: null,
            modelDefaults: { model: 'gpt-4o-mini' },
            createdAt: '2026-10-19T00:00:00Z',
            createdBy: 'u-1',
          },
        ],
      }),
    );

    mockPromptService.previewPrompt.and.returnValue(
      of({
        resolvedPrompt: 'Classify: Test query into Billing',
        detectedVariables: ['query', 'category'],
        missingVariables: [],
        characterCount: 32,
        estimatedTokens: 8,
      }),
    );

    mockPromptService.runPlayground.and.returnValue(
      of({
        success: true,
        model: 'gpt-4o-mini',
        content: 'Category: Billing',
        latencyMs: 120,
        usage: {
          promptTokens: 10,
          completionTokens: 4,
          totalTokens: 14,
          source: 'provider-reported',
        },
        resolvedPrompt: 'Classify: Test query into Billing',
      }),
    );

    await TestBed.configureTestingModule({
      imports: [PromptStudioComponent],
      providers: [
        provideRouter([]),
        { provide: PromptService, useValue: mockPromptService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PromptStudioComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component and default to library view', () => {
    expect(component).toBeTruthy();
    expect(component.viewMode()).toBe('library');
    expect(component.prompts().length).toBe(1);
  });

  it('should extract detected variables from template text', () => {
    component.templateBody = 'Explain {{topic}} in {{style}} style.';
    const detected = component.detectedVariables();
    expect(detected).toEqual(['topic', 'style']);
  });

  it('should calculate estimated token count based on template length', () => {
    component.templateBody = '12345678'; // 8 chars / 4 = 2 tokens
    expect(component.estimatedTemplateTokens()).toBe(2);
  });

  it('should toggle composable techniques without mutual exclusivity', () => {
    component.selectedTechniques = ['zero-shot'];
    component.toggleTechnique('few-shot');
    expect(component.isTechniqueSelected('zero-shot')).toBe(true);
    expect(component.isTechniqueSelected('few-shot')).toBe(true);

    component.toggleTechnique('RTF');
    expect(component.isTechniqueSelected('RTF')).toBe(true);

    component.toggleTechnique('zero-shot');
    expect(component.isTechniqueSelected('zero-shot')).toBe(false);
  });

  it('should switch to editor view when opening a prompt', () => {
    component.openPromptEditor('p-1');
    expect(component.viewMode()).toBe('editor');
    expect(mockPromptService.getPrompt).toHaveBeenCalledWith('p-1');
    expect(component.promptName).toBe('Customer Support Classifier');
    expect(component.selectedVersionNumber()).toBe(2);
  });

  it('should set runError if required variables are empty when running playground', () => {
    component.createNewPromptDraft();
    component.templateBody = 'Hello {{name}}!';
    component.variableValues = { name: '' };

    component.runPlayground();

    expect(component.runError()).toContain('Missing required variable(s): name');
    expect(mockPromptService.runPlayground).not.toHaveBeenCalled();
  });

  it('should execute runPlayground successfully and update runResult with latency and token metrics', () => {
    component.templateBody = 'Classify: {{query}} into {{category}}';
    component.variableValues = { query: 'Test query', category: 'Billing' };
    component.selectedModel = 'gpt-4o-mini';

    component.runPlayground();

    expect(mockPromptService.runPlayground).toHaveBeenCalled();
    expect(component.runResult()?.success).toBe(true);
    expect(component.runResult()?.latencyMs).toBe(120);
    expect(component.runResult()?.usage?.source).toBe('provider-reported');
  });

  it('should handle empty model list from gateway gracefully and clear selectedModel', () => {
    mockPromptService.getModels.and.returnValue(
      of({ models: [], gatewayConnected: true }),
    );
    component.loadModels();
    expect(component.availableModels()).toEqual([]);
    expect(component.selectedModel).toBe('');

    component.templateBody = 'Simple template';
    component.runPlayground();
    expect(component.runError()).toContain('No model selected or available');
  });

  it('should handle gateway disconnection gracefully', () => {
    mockPromptService.getModels.and.returnValue(
      of({ models: [], gatewayConnected: false }),
    );
    component.loadModels();
    expect(component.availableModels()).toEqual([]);
    expect(component.gatewayConnected()).toBe(false);
    expect(component.selectedModel).toBe('');
  });
});
