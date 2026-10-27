import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { UsageComponent } from './usage.component';
import {
  UsageService,
  QuotaPeriodStatus,
  UsageRecordItem,
  QuotaPolicy,
} from '../../services/usage.service';
import { of, throwError } from 'rxjs';
import { ToastService } from '../../shared/feedback/toast.service';

describe('UsageComponent', () => {
  let component: UsageComponent;
  let fixture: ComponentFixture<UsageComponent>;
  let mockUsageService: any;

  const mockStatus: QuotaPeriodStatus = {
    userId: 'dev-user-001',
    periodId: 'period-1',
    periodStart: '2026-10-01T00:00:00.000Z',
    periodEnd: '2026-11-01T00:00:00.000Z',
    resetDate: '2026-11-01T00:00:00.000Z',
    tokenLimit: 1_000_000,
    actualTokens: 120_000,
    reservedTokens: 15_000,
    remainingTokens: 865_000,
    percentUsed: 12.0,
    percentReserved: 1.5,
    status: 'active',
    rateLimit: {
      limitPerMinute: 60,
    },
    estimatedTotalCost: 0.1584,
  };

  const mockLedger: UsageRecordItem[] = [
    {
      id: 'rec-1',
      requestId: 'req-play-123',
      userId: 'dev-user-001',
      conversationId: null,
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      tokenUsageSource: 'provider-reported',
      reservedTokens: 500,
      estimatedCost: 0.000045,
      status: 'reconciled',
      createdAt: '2026-10-19T10:00:00.000Z',
      reconciledAt: '2026-10-19T10:00:01.000Z',
    },
    {
      id: 'rec-2',
      requestId: 'req-exp-a-456',
      userId: 'dev-user-001',
      conversationId: null,
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      tokenUsageSource: 'estimated',
      reservedTokens: 1200,
      estimatedCost: null,
      status: 'reserved',
      createdAt: '2026-10-19T11:00:00.000Z',
      reconciledAt: null,
    },
    {
      id: 'rec-3',
      requestId: 'req-conv-789',
      userId: 'dev-user-001',
      conversationId: 'c-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      tokenUsageSource: 'estimated',
      reservedTokens: 2000,
      estimatedCost: null,
      status: 'failed',
      createdAt: '2026-10-19T12:00:00.000Z',
      reconciledAt: '2026-10-19T12:00:05.000Z',
    },
  ];

  const mockPolicy: QuotaPolicy = {
    id: 'qp-1',
    scope: 'user',
    scopeId: 'dev-user-001',
    monthlyTokenLimit: 1_000_000,
    requestRateLimit: 60,
    effectiveFrom: '2026-10-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockUsageService = {
      getStatus: jasmine.createSpy('getStatus').and.returnValue(of(mockStatus)),
      getLedger: jasmine.createSpy('getLedger').and.returnValue(of(mockLedger)),
      getPolicy: jasmine.createSpy('getPolicy').and.returnValue(of(mockPolicy)),
      updatePolicy: jasmine.createSpy('updatePolicy').and.returnValue(
        of({ ...mockPolicy, monthlyTokenLimit: 500_000 }),
      ),
      resetPeriodForDemo: jasmine.createSpy('resetPeriodForDemo').and.returnValue(
        of({ success: true, message: 'Reset successfully', status: { ...mockStatus, actualTokens: 0, reservedTokens: 0 } }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [UsageComponent],
      providers: [{ provide: UsageService, useValue: mockUsageService }],
    }).compileComponents();

    fixture = TestBed.createComponent(UsageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load quota status and ledger records on init', () => {
    expect(component).toBeTruthy();
    expect(mockUsageService.getStatus).toHaveBeenCalled();
    expect(mockUsageService.getLedger).toHaveBeenCalled();
    expect(component.status).toEqual(mockStatus);
    expect(component.ledger.length).toBe(3);
    expect(component.loading).toBe(false);
  });

  it('should display distinct values for monthly allowance, used, reserved, and remaining', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const statValues = compiled.querySelectorAll('.stat-value');

    // Card 1: 1,000,000 (monthly allowance)
    expect(statValues[0].textContent).toContain('1,000,000');
    // Card 2: 120,000 (actual provider-reported used)
    expect(statValues[1].textContent).toContain('120,000');
    // Card 3: 15,000 (in-flight reserved)
    expect(statValues[2].textContent).toContain('15,000');
    // Card 4: 865,000 (remaining allowance)
    expect(statValues[3].textContent).toContain('865,000');
  });

  it('should filter usage ledger by status', () => {
    expect(component.filteredLedger.length).toBe(3);

    component.statusFilter = 'reconciled';
    expect(component.filteredLedger.length).toBe(1);
    expect(component.filteredLedger[0].status).toBe('reconciled');

    component.statusFilter = 'reserved';
    expect(component.filteredLedger.length).toBe(1);
    expect(component.filteredLedger[0].status).toBe('reserved');

    component.statusFilter = 'failed';
    expect(component.filteredLedger.length).toBe(1);
    expect(component.filteredLedger[0].status).toBe('failed');
  });

  it('should correctly label request context from requestId prefix or conversationId', () => {
    expect(component.getContextLabel(mockLedger[0])).toBe('Playground');
    expect(component.getContextLabel(mockLedger[1])).toBe('Comparison');
    expect(component.getContextLabel(mockLedger[2])).toBe('Conversation');
  });

  it('should update quota policy when savePolicy is invoked', () => {
    component.editLimit = 500_000;
    component.editRateLimit = 30;
    component.savePolicy();

    expect(mockUsageService.updatePolicy).toHaveBeenCalledWith({
      monthlyTokenLimit: 500_000,
      requestRateLimit: 30,
    });
    expect(component.successMessage).toContain('updated successfully');
  });

  it('should simulate near-quota limit by calculating limit near current usage', () => {
    component.simulateNearQuota();

    // actualTokens (120,000) + reservedTokens (15,000) + 50 = 135,050
    expect(mockUsageService.updatePolicy).toHaveBeenCalledWith(
      jasmine.objectContaining({ monthlyTokenLimit: 135_050 }),
    );
  });

  it('should handle API errors gracefully', () => {
    mockUsageService.getStatus.and.returnValue(
      throwError(() => new Error('Service unavailable')),
    );

    component.loadAll();

    expect(component.errorMessage).toContain('Failed to load quota status');
    expect(component.loading).toBe(false);
  });

  it('shows an error toast when copying to the clipboard fails', fakeAsync(() => {
    spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.reject(new Error('denied')));
    const toast = TestBed.inject(ToastService);
    spyOn(toast, 'error');

    component.copyRequestId('req-1');
    flushMicrotasks();

    expect(toast.error).toHaveBeenCalledWith('Could not copy to the clipboard.');
    expect(component.copiedId).toBeNull();
  }));
});
