import { DestroyRef, Injectable, inject, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const DEFAULT_DURATION_MS = 5000;
const ERROR_DURATION_MS = 8000;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimers());
  }

  info(message: string): number {
    return this.show('info', message);
  }

  success(message: string): number {
    return this.show('success', message);
  }

  error(message: string): number {
    return this.show('error', message);
  }

  show(kind: ToastKind, message: string, durationMs?: number): number {
    const id = this.nextId++;
    this._toasts.update((list) => [...list, { id, kind, message }]);
    const ms = durationMs ?? (kind === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), ms),
    );
    return id;
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private clearTimers(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }
}
