import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogDirective } from '../a11y/dialog.directive';
import { ConfirmService } from './confirm.service';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [DialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (confirmService.request(); as req) {
      <div class="confirm-backdrop" (click)="confirmService.respond(false)">
        <div
          class="confirm-card"
          appDialog="confirm-dialog-title"
          (dialogClose)="confirmService.respond(false)"
          (click)="$event.stopPropagation()"
        >
          <h3 class="confirm-title" id="confirm-dialog-title">
            {{ req.title || 'Please confirm' }}
          </h3>
          <p class="confirm-message">{{ req.message }}</p>
          <div class="confirm-actions">
            <button
              type="button"
              class="btn btn-secondary"
              data-autofocus
              (click)="confirmService.respond(false)"
            >
              {{ req.cancelLabel || 'Cancel' }}
            </button>
            <button
              type="button"
              class="btn"
              [class.btn-danger]="req.destructive !== false"
              [class.btn-primary]="req.destructive === false"
              (click)="confirmService.respond(true)"
            >
              {{ req.confirmLabel || 'Confirm' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .confirm-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1100;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-overlay);
      padding: var(--space-4);
    }
    .confirm-card {
      width: 100%;
      max-width: 420px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-overlay);
      padding: var(--space-5);
    }
    .confirm-title {
      margin: 0 0 var(--space-2);
      font-size: 16px;
      color: var(--color-text);
    }
    .confirm-message {
      margin: 0 0 var(--space-5);
      font-size: 13px;
      color: var(--color-text-secondary);
    }
    .confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
    }
  `,
})
export class ConfirmDialogComponent {
  protected readonly confirmService = inject(ConfirmService);
}
