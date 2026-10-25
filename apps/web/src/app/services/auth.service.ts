import { Injectable, signal, computed } from '@angular/core';
import { environment } from '../../environments/environment';

export const TOKEN_STORAGE_KEY = 'promptlab_token';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly tokenSignal = signal<string | null>(this.loadInitialToken());

  readonly token = this.tokenSignal.asReadonly();
  readonly isAuthenticated = computed(() => Boolean(this.tokenSignal()));

  private loadInitialToken(): string | null {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (stored && stored.trim()) {
        return stored.trim();
      }
    }
    // Only available in development environment (environment.development.ts)
    if (environment.devToken) {
      return environment.devToken;
    }
    return null;
  }

  getToken(): string | null {
    return this.tokenSignal();
  }

  setToken(token: string): void {
    const cleanToken = token.trim();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOKEN_STORAGE_KEY, cleanToken);
    }
    this.tokenSignal.set(cleanToken);
  }

  clearToken(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
    this.tokenSignal.set(null);
  }
}
