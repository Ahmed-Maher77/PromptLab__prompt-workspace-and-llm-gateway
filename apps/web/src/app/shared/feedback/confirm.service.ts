import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (result: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly _request = signal<ConfirmRequest | null>(null);
  readonly request = this._request.asReadonly();

  /** Resolves true when confirmed, false when cancelled or dismissed. */
  confirm(options: ConfirmOptions | string): Promise<boolean> {
    const opts = typeof options === 'string' ? { message: options } : options;
    this._request()?.resolve(false);
    return new Promise<boolean>((resolve) => {
      this._request.set({ ...opts, resolve });
    });
  }

  respond(result: boolean): void {
    const current = this._request();
    if (!current) {
      return;
    }
    this._request.set(null);
    current.resolve(result);
  }
}
