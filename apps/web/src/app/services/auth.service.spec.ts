import { TestBed } from '@angular/core/testing';
import { AuthService, TOKEN_STORAGE_KEY } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [AuthService],
    });
    service = TestBed.inject(AuthService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('sets, retrieves, and clears authentication tokens in localStorage and reactive signals', () => {
    service.setToken('test-api-key-123');
    expect(service.getToken()).toBe('test-api-key-123');
    expect(service.isAuthenticated()).toBe(true);
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('test-api-key-123');

    service.clearToken();
    expect(service.getToken()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});
