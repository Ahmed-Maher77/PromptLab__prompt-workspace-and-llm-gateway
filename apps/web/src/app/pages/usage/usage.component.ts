import { Component, OnInit, ChangeDetectionStrategy, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideRefreshCw,
  LucideCircleAlert,
  LucideCircleCheck,
  LucideClock,
} from '@lucide/angular';
import {
  UsageService,
  QuotaPeriodStatus,
  UsageRecordItem,
  UsageOperation,
  UsageRecordStatus,
  QuotaPolicy,
} from '../../services/usage.service';
import { ConfirmService } from '../../shared/feedback/confirm.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { toApiErrorMessage } from '../../utils/api-error.util';

const CONTEXT_LABELS: Record<UsageOperation, string> = {
  playground: 'Playground',
  comparison: 'Comparison',
  conversation: 'Conversation',
  compaction: 'Compaction',
  gateway: 'Gateway',
};

@Component({
  selector: 'app-usage',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideRefreshCw,
    LucideCircleAlert,
    LucideCircleCheck,
    LucideClock,
  ],
  templateUrl: './usage.component.html',
  styleUrls: ['./usage.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class UsageComponent implements OnInit {
  status: QuotaPeriodStatus | null = null;
  ledger: UsageRecordItem[] = [];
  policy: QuotaPolicy | null = null;

  loading = true;
  savingPolicy = false;
  resetting = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;

  // Policy Form
  editLimit = 1_000_000;
  editRateLimit = 60;

  // Filter
  statusFilter: 'all' | UsageRecordStatus = 'all';
  copiedId: string | null = null;

  private readonly confirmService = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly usageService: UsageService) {
    inject(DestroyRef).onDestroy(() => this.timers.forEach((t) => clearTimeout(t)));
  }

  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.loading = true;
    this.errorMessage = null;

    this.usageService.getStatus().subscribe({
      next: (status) => {
        this.status = status;
        this.editLimit = status.tokenLimit;
        this.editRateLimit = status.rateLimit.limitPerMinute;
        this.loading = false;
      },
      error: (err) => {
        this.errorMessage = `Failed to load quota status: ${toApiErrorMessage(err, 'Server error')}`;
        this.loading = false;
      },
    });

    this.usageService.getLedger(100).subscribe({
      next: (records) => {
        this.ledger = records;
      },
      error: (err) => {
        console.error('Failed to load usage ledger:', err);
      },
    });

    this.usageService.getPolicy().subscribe({
      next: (policy) => {
        this.policy = policy;
      },
      error: (err) => {
        console.error('Failed to load quota policy:', err);
      },
    });
  }

  get filteredLedger(): UsageRecordItem[] {
    if (this.statusFilter === 'all') {
      return this.ledger;
    }
    return this.ledger.filter((r) => r.status === this.statusFilter);
  }

  savePolicy(): void {
    this.savingPolicy = true;
    this.errorMessage = null;
    this.successMessage = null;

    this.usageService
      .updatePolicy({
        monthlyTokenLimit: Number(this.editLimit),
        requestRateLimit: Number(this.editRateLimit),
      })
      .subscribe({
        next: () => {
          this.savingPolicy = false;
          this.successMessage = 'Quota policy updated successfully.';
          this.later(() => (this.successMessage = null), 4000);
          this.loadAll();
        },
        error: (err) => {
          this.savingPolicy = false;
          this.errorMessage = `Failed to update policy: ${toApiErrorMessage(err, 'Server error')}`;
        },
      });
  }

  /**
   * Helper to simulate near-exhausted quota for immediate validation in Playground/Compare/Conversations.
   */
  simulateNearQuota(): void {
    if (!this.status) return;
    const currentActual = this.status.actualTokens + this.status.reservedTokens;
    // Set limit to used + 50 tokens so next prompt run easily hits quota
    this.editLimit = Math.max(1000, currentActual + 50);
    this.savePolicy();
  }

  async resetDemoUsage(): Promise<void> {
    const confirmed = await this.confirmService.confirm({
      title: 'Reset demo usage',
      message: 'Reset current month token usage and active reservations to 0 for demo/testing?',
      confirmLabel: 'Reset usage',
    });
    if (!confirmed) {
      return;
    }

    this.resetting = true;
    this.errorMessage = null;
    this.successMessage = null;

    this.usageService.resetPeriodForDemo().subscribe({
      next: (res) => {
        this.resetting = false;
        this.successMessage = res.message || 'Current period tokens reset successfully.';
        this.later(() => (this.successMessage = null), 4000);
        this.loadAll();
      },
      error: (err) => {
        this.resetting = false;
        this.errorMessage = `Failed to reset demo usage: ${toApiErrorMessage(err, 'Server error')}`;
      },
    });
  }

  copyRequestId(id: string): void {
    navigator.clipboard
      .writeText(id)
      .then(() => {
        this.copiedId = id;
        this.later(() => {
          if (this.copiedId === id) this.copiedId = null;
        }, 2000);
      })
      .catch(() => this.toast.error('Could not copy to the clipboard.'));
  }

  getContextLabel(record: UsageRecordItem): string {
    if (record.operation) return CONTEXT_LABELS[record.operation];
    if (record.conversationId) return 'Conversation';
    if (record.requestId.startsWith('req-exp')) return 'Comparison';
    if (record.requestId.startsWith('req-play')) return 'Playground';
    return 'Gateway';
  }

  formatDate(isoString: string): string {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    } catch {
      return isoString;
    }
  }
}
