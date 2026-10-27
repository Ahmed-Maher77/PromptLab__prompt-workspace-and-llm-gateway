import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ObservabilityComponent } from './observability.component';
import {
  ObservabilityService,
  ObservabilityStatus,
  TraceRecord,
} from '../../services/observability.service';
import { of, throwError } from 'rxjs';
import { ConfirmService } from '../../shared/feedback/confirm.service';

describe('ObservabilityComponent', () => {
  let component: ObservabilityComponent;
  let fixture: ComponentFixture<ObservabilityComponent>;
  let mockObservabilityService: any;

  const mockStatus: ObservabilityStatus = {
    telemetryEnabled: true,
    otelConfigured: true,
    otelEndpoint: 'http://localhost:4318/v1/traces',
    langfuseConfigured: false,
    langfuseHost: null,
    totalTracesRecorded: 2,
    privacyRedactionActive: true,
    supportedTracedOperations: [
      'playground.execute',
      'comparison.slot',
      'conversation.turn',
      'gateway.request',
    ],
  };

  const mockTraces: TraceRecord[] = [
    {
      id: 'trace-11111111111111111111111111111111',
      name: 'Playground Execution',
      operation: 'playground.execute',
      status: 'success',
      startTime: '2026-10-19T10:00:00.000Z',
      endTime: '2026-10-19T10:00:01.500Z',
      durationMs: 1500,
      model: 'gpt-4o',
      provider: 'openai',
      userId: 'dev-user-001',
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      tokenUsageSource: 'litellm',
      estimatedCost: 0.001,
      errorCode: null,
      errorMessage: null,
      metadata: {
        traceparent: '00-trace-11111111111111111111111111111111-span1-01',
      },
      spans: [
        {
          id: 'span-root',
          name: 'Playground Execution',
          startTime: '2026-10-19T10:00:00.000Z',
          endTime: '2026-10-19T10:00:01.500Z',
          durationMs: 1500,
          status: 'ok',
          attributes: { 'llm.model': 'gpt-4o' },
        },
        {
          id: 'span-child',
          parentSpanId: 'span-root',
          name: 'quota.reserve',
          startTime: '2026-10-19T10:00:00.050Z',
          endTime: '2026-10-19T10:00:00.070Z',
          durationMs: 20,
          status: 'ok',
          attributes: { quotaReserved: 1000 },
        },
      ],
    },
    {
      id: 'trace-22222222222222222222222222222222',
      name: 'Comparison Slot Run',
      operation: 'comparison.slot',
      status: 'error',
      startTime: '2026-10-19T11:00:00.000Z',
      endTime: '2026-10-19T11:00:00.800Z',
      durationMs: 800,
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      userId: 'dev-user-001',
      inputTokens: 50,
      outputTokens: 0,
      totalTokens: 50,
      tokenUsageSource: 'estimated',
      estimatedCost: null,
      errorCode: 'GATEWAY_TIMEOUT',
      errorMessage: 'Gateway timed out waiting for upstream',
      metadata: {},
      spans: [],
    },
  ];

  beforeEach(async () => {
    mockObservabilityService = {
      getStatus: jasmine.createSpy('getStatus').and.returnValue(of(mockStatus)),
      getTraces: jasmine.createSpy('getTraces').and.returnValue(of(mockTraces)),
      getTrace: jasmine.createSpy('getTrace').and.returnValue(of(mockTraces[0])),
      clearTraces: jasmine.createSpy('clearTraces').and.returnValue(
        of({ success: true, message: 'Cleared' }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [ObservabilityComponent],
      providers: [{ provide: ObservabilityService, useValue: mockObservabilityService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ObservabilityComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load observability status and traces on init', () => {
    expect(component).toBeTruthy();
    expect(mockObservabilityService.getStatus).toHaveBeenCalled();
    expect(mockObservabilityService.getTraces).toHaveBeenCalled();
    expect(component.status).toEqual(mockStatus);
    expect(component.traces.length).toBe(2);
    expect(component.loading).toBe(false);
  });

  it('should select a trace and open the waterfall drawer', () => {
    component.selectTrace(mockTraces[0]);
    expect(component.selectedTrace).toEqual(mockTraces[0]);

    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.trace-drawer')).toBeTruthy();
    expect(compiled.querySelector('.drawer-title')?.textContent).toContain('Trace Details');
  });

  it('should toggle span expansion', () => {
    expect(component.isSpanExpanded('span-1')).toBe(false);
    component.toggleSpanExpanded('span-1');
    expect(component.isSpanExpanded('span-1')).toBe(true);
    component.toggleSpanExpanded('span-1');
    expect(component.isSpanExpanded('span-1')).toBe(false);
  });

  it('should format cost, duration, and dates properly', () => {
    expect(component.formatCost(null)).toBe('—');
    expect(component.formatCost(0.00002)).toBe('< $0.0001');
    expect(component.formatCost(0.005)).toBe('$0.0050');
    expect(component.formatDuration(500)).toBe('500ms');
    expect(component.formatDuration(1500)).toBe('1.50s');
  });

  it('should handle service errors gracefully', () => {
    mockObservabilityService.getTraces.and.returnValue(
      throwError(() => new Error('Observability service error')),
    );

    component.loadData();
    expect(component.errorMessage).toContain('Failed to load traces');
    expect(component.loading).toBe(false);
  });

  it('selects a trace row with the Enter key', () => {
    const row = (fixture.nativeElement as HTMLElement).querySelector(
      'tr.trace-row',
    ) as HTMLElement;
    expect(row.getAttribute('tabindex')).toBe('0');

    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(component.selectedTrace?.id).toBe(mockTraces[0].id);
  });

  it('selects a trace row with the Space key without scrolling', () => {
    const row = (fixture.nativeElement as HTMLElement).querySelector(
      'tr.trace-row',
    ) as HTMLElement;
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    row.dispatchEvent(event);
    expect(event.defaultPrevented).toBeTrue();
    expect(component.selectedTrace?.id).toBe(mockTraces[0].id);
  });

  it('exposes the trace drawer as a labelled dialog that closes on Escape', () => {
    component.selectTrace(mockTraces[0]);
    fixture.detectChanges();

    const drawer = (fixture.nativeElement as HTMLElement).querySelector(
      '.trace-drawer',
    ) as HTMLElement;
    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(drawer.getAttribute('aria-labelledby') as string)).toBeTruthy();

    drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(component.selectedTrace).toBeNull();
  });

  it('toggles span expansion from a real button', () => {
    component.selectTrace(mockTraces[0]);
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector(
      'button.span-info',
    ) as HTMLButtonElement;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    fixture.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not clear traces when the confirmation is declined', async () => {
    spyOn(TestBed.inject(ConfirmService), 'confirm').and.resolveTo(false);
    await component.clearTraces();
    expect(mockObservabilityService.clearTraces).not.toHaveBeenCalled();
  });

  it('clears traces when the confirmation is accepted', async () => {
    spyOn(TestBed.inject(ConfirmService), 'confirm').and.resolveTo(true);
    await component.clearTraces();
    expect(mockObservabilityService.clearTraces).toHaveBeenCalled();
  });
});
