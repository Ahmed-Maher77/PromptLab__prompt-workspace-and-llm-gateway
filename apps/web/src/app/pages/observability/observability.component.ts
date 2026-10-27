import { Component, OnInit, ChangeDetectionStrategy, DestroyRef, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideTrash,
  LucideRefreshCw,
  LucideCircleAlert,
  LucideCircleCheck,
  LucideActivity,
  LucideX,
  LucideChevronDown,
  LucideChevronRight,
} from '@lucide/angular';
import { DialogDirective } from '../../shared/a11y/dialog.directive';
import { ConfirmService } from '../../shared/feedback/confirm.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { toApiErrorMessage } from '../../utils/api-error.util';
import {
  ObservabilityService,
  ObservabilityStatus,
  TraceRecord,
  TraceSpan,
} from '../../services/observability.service';

@Component({
  selector: 'app-observability',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideTrash,
    LucideRefreshCw,
    LucideCircleAlert,
    LucideCircleCheck,
    LucideActivity,
    LucideX,
    LucideChevronDown,
    LucideChevronRight,
    DialogDirective,
  ],
  templateUrl: './observability.component.html',
  styleUrls: ['./observability.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ObservabilityComponent implements OnInit {
  status: ObservabilityStatus | null = null;
  traces: TraceRecord[] = [];
  selectedTrace: TraceRecord | null = null;

  loading = true;
  clearing = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;

  // Filters
  statusFilter = 'all';
  operationFilter = 'all';
  modelFilter = '';
  copiedId: string | null = null;

  // Expanded span attribute ids
  expandedSpanIds = new Set<string>();

  private readonly confirmService = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  // Only the latest traces request may update the table (filters can change quickly).
  private tracesRequest?: Subscription;

  constructor(private readonly observabilityService: ObservabilityService) {
    inject(DestroyRef).onDestroy(() => {
      this.timers.forEach((t) => clearTimeout(t));
      this.tracesRequest?.unsubscribe();
    });
  }

  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading = true;
    this.errorMessage = null;

    this.observabilityService.getStatus().subscribe({
      next: (status) => {
        this.status = status;
      },
      error: (err) => {
        this.errorMessage = `Failed to load observability status: ${toApiErrorMessage(err, 'Server error')}`;
      },
    });

    this.tracesRequest?.unsubscribe();
    this.tracesRequest = this.observabilityService
      .getTraces({
        status: this.statusFilter !== 'all' ? this.statusFilter : undefined,
        operation: this.operationFilter !== 'all' ? this.operationFilter : undefined,
        model: this.modelFilter.trim() || undefined,
        limit: 100,
      })
      .subscribe({
        next: (traces) => {
          this.traces = traces;
          this.loading = false;
          if (this.selectedTrace) {
            // refresh selected trace reference
            const found = traces.find((t) => t.id === this.selectedTrace!.id);
            if (found) {
              this.selectedTrace = found;
            }
          }
        },
        error: (err) => {
          this.errorMessage = `Failed to load traces: ${toApiErrorMessage(err, 'Server error')}`;
          this.loading = false;
        },
      });
  }

  applyFilters(): void {
    this.loadData();
  }

  selectTrace(trace: TraceRecord): void {
    this.selectedTrace = trace;
    this.expandedSpanIds.clear();
  }

  onRowKey(event: Event, trace: TraceRecord): void {
    // Inner controls (e.g. the Inspect button) handle their own keys.
    if (event.target !== event.currentTarget) {
      return;
    }
    event.preventDefault();
    this.selectTrace(trace);
  }

  closeDrawer(): void {
    this.selectedTrace = null;
  }

  toggleSpanExpanded(spanId: string): void {
    if (this.expandedSpanIds.has(spanId)) {
      this.expandedSpanIds.delete(spanId);
    } else {
      this.expandedSpanIds.add(spanId);
    }
  }

  isSpanExpanded(spanId: string): boolean {
    return this.expandedSpanIds.has(spanId);
  }

  async clearTraces(): Promise<void> {
    const confirmed = await this.confirmService.confirm({
      title: 'Clear traces',
      message: 'Are you sure you want to clear all in-memory traces?',
      confirmLabel: 'Clear traces',
    });
    if (!confirmed) {
      return;
    }

    this.clearing = true;
    this.observabilityService.clearTraces().subscribe({
      next: () => {
        this.clearing = false;
        this.successMessage = 'In-memory traces cleared.';
        this.selectedTrace = null;
        this.loadData();
        this.later(() => (this.successMessage = null), 4000);
      },
      error: (err) => {
        this.clearing = false;
        this.errorMessage = `Failed to clear traces: ${toApiErrorMessage(err, 'Server error')}`;
      },
    });
  }

  copyToClipboard(text: string, id: string): void {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.copiedId = id;
        this.later(() => {
          if (this.copiedId === id) {
            this.copiedId = null;
          }
        }, 2000);
      })
      .catch(() => this.toast.error('Could not copy to the clipboard.'));
  }

  formatCost(cost: number | null | undefined): string {
    if (cost === null || cost === undefined) return '—';
    if (cost < 0.0001) return `< $0.0001`;
    return `$${cost.toFixed(4)}`;
  }

  formatDuration(durationMs: number): string {
    if (durationMs < 1000) return `${durationMs}ms`;
    return `${(durationMs / 1000).toFixed(2)}s`;
  }

  formatDate(isoString: string): string {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return isoString;
    }
  }

  calculateSpanLeftPercent(span: TraceSpan, rootTrace: TraceRecord): number {
    if (!rootTrace.durationMs || rootTrace.durationMs <= 0) return 0;
    const rootStart = new Date(rootTrace.startTime).getTime();
    const spanStart = new Date(span.startTime).getTime();
    const diff = Math.max(0, spanStart - rootStart);
    const pct = (diff / rootTrace.durationMs) * 100;
    return Math.min(95, Math.max(0, pct));
  }

  calculateSpanWidthPercent(span: TraceSpan, rootTrace: TraceRecord): number {
    if (!rootTrace.durationMs || rootTrace.durationMs <= 0) return 100;
    const pct = (span.durationMs / rootTrace.durationMs) * 100;
    return Math.max(5, Math.min(100, pct));
  }

  getAttributeKeys(attributes: Record<string, unknown>): string[] {
    return Object.keys(attributes || {});
  }

  formatAttributeValue(val: unknown): string {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'object') return JSON.stringify(val, null, 2);
    return String(val);
  }
}
