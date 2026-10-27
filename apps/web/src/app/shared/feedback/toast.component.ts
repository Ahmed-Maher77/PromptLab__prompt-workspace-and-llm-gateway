import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideX } from '@lucide/angular';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toast-stack">
      @for (toast of toasts.toasts(); track toast.id) {
        <div
          class="toast"
          [class.toast-error]="toast.kind === 'error'"
          [class.toast-success]="toast.kind === 'success'"
          [attr.role]="toast.kind === 'error' ? 'alert' : 'status'"
          [attr.aria-live]="toast.kind === 'error' ? 'assertive' : 'polite'"
        >
          <span class="toast-message">{{ toast.message }}</span>
          <button
            type="button"
            class="toast-close"
            aria-label="Dismiss notification"
            (click)="toasts.dismiss(toast.id)"
          >
            <svg lucideX [size]="14" aria-hidden="true"></svg>
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .toast-stack {
      position: fixed;
      right: var(--space-4);
      bottom: var(--space-4);
      z-index: 1200;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      max-width: min(420px, calc(100vw - 32px));
    }
    .toast {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      background: var(--color-info-bg);
      color: var(--color-text);
      border: 1px solid var(--color-primary-border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-overlay);
      font-size: 13px;
    }
    .toast-success {
      background: var(--color-success-bg);
      border-color: var(--color-success-border);
    }
    .toast-error {
      background: var(--color-danger-bg);
      border-color: var(--color-danger-border);
      color: var(--color-danger-strong);
    }
    .toast-message {
      flex: 1;
      overflow-wrap: anywhere;
    }
    .toast-close {
      background: none;
      border: none;
      padding: 2px;
      color: inherit;
      cursor: pointer;
      display: inline-flex;
    }
  `,
})
export class ToastComponent {
  protected readonly toasts = inject(ToastService);
}
