import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UsageService, QuotaPeriodStatus, UsageRecordItem, QuotaPolicy } from './usage.service';

describe('UsageService', () => {
  let service: UsageService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UsageService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(UsageService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('fetches quota period status', (done) => {
    const mockStatus: QuotaPeriodStatus = {
      userId: 'dev-user-001',
      periodId: '2026-10',
      periodStart: '2026-10-01T00:00:00Z',
      periodEnd: '2026-10-31T23:59:59Z',
      resetDate: '2026-11-01T00:00:00Z',
      tokenLimit: 100000,
      actualTokens: 15000,
      reservedTokens: 2000,
      remainingTokens: 83000,
      percentUsed: 15,
      percentReserved: 2,
      status: 'active',
      rateLimit: {
        limitPerMinute: 60,
        currentMinuteRequests: 5,
        remainingRequests: 55,
      },
      estimatedTotalCost: 0.05,
    };

    service.getStatus().subscribe((status) => {
      expect(status.userId).toBe('dev-user-001');
      expect(status.tokenLimit).toBe(100000);
      expect(status.remainingTokens).toBe(83000);
      done();
    });

    const req = httpTesting.expectOne('/api/usage/status');
    expect(req.request.method).toBe('GET');
    req.flush(mockStatus);
  });

  it('fetches usage ledger with limit parameter', (done) => {
    const mockLedger: UsageRecordItem[] = [
      {
        id: 'rec-1',
        requestId: 'req-1',
        userId: 'dev-user-001',
        conversationId: null,
        provider: 'openai',
        model: 'gpt-4o-mini',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        tokenUsageSource: 'provider-reported',
        reservedTokens: 300,
        estimatedCost: 0.0002,
        status: 'reconciled',
        createdAt: '2026-10-23T00:00:00Z',
        reconciledAt: '2026-10-23T00:00:02Z',
      },
    ];

    service.getLedger(25).subscribe((records) => {
      expect(records.length).toBe(1);
      expect(records[0].model).toBe('gpt-4o-mini');
      done();
    });

    const req = httpTesting.expectOne('/api/usage/ledger?limit=25');
    expect(req.request.method).toBe('GET');
    req.flush(mockLedger);
  });

  it('fetches and updates quota policy', (done) => {
    const mockPolicy: QuotaPolicy = {
      id: 'pol-1',
      scope: 'user',
      scopeId: 'dev-user-001',
      monthlyTokenLimit: 200000,
      requestRateLimit: 120,
      effectiveFrom: '2026-01-01T00:00:00Z',
    };

    service.getPolicy().subscribe((policy) => {
      expect(policy.monthlyTokenLimit).toBe(200000);
    });

    const getReq = httpTesting.expectOne('/api/usage/policy');
    getReq.flush(mockPolicy);

    service.updatePolicy({ monthlyTokenLimit: 250000 }).subscribe((updated) => {
      expect(updated.monthlyTokenLimit).toBe(250000);
      done();
    });

    const putReq = httpTesting.expectOne('/api/usage/policy');
    expect(putReq.request.method).toBe('PUT');
    putReq.flush({ ...mockPolicy, monthlyTokenLimit: 250000 });
  });

  it('resets period for demo', (done) => {
    service.resetPeriodForDemo().subscribe((res) => {
      expect(res.success).toBe(true);
      done();
    });

    const req = httpTesting.expectOne('/api/usage/reset');
    expect(req.request.method).toBe('POST');
    req.flush({ success: true, message: 'Reset successful' });
  });
});
