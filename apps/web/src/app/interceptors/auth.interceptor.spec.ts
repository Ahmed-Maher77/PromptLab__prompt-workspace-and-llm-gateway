import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

describe('authInterceptor (SEC-01b)', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(() => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['getToken', 'clearToken']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Router, useValue: routerSpy },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('attaches Authorization header only to API requests when token is present', () => {
    authServiceSpy.getToken.and.returnValue('my-jwt-token-xyz');

    http.get('/api/conversations').subscribe();

    const req = httpMock.expectOne('/api/conversations');
    expect(req.request.headers.get('Authorization')).toBe('Bearer my-jwt-token-xyz');
    req.flush([]);
  });

  it('does NOT attach Authorization header to non-API requests', () => {
    authServiceSpy.getToken.and.returnValue('my-jwt-token-xyz');

    http.get('https://external-domain.com/metrics').subscribe();

    const req = httpMock.expectOne('https://external-domain.com/metrics');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('does NOT attach Authorization header if no token is available', () => {
    authServiceSpy.getToken.and.returnValue(null);

    http.get('/api/health').subscribe();

    const req = httpMock.expectOne('/api/health');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('clears stored token and navigates to /login on HTTP 401 Unauthorized', () => {
    authServiceSpy.getToken.and.returnValue('expired-token');

    http.get('/api/prompts').subscribe({
      next: () => fail('Should have failed with 401'),
      error: (err) => {
        expect(err.status).toBe(401);
      },
    });

    const req = httpMock.expectOne('/api/prompts');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(authServiceSpy.clearToken).toHaveBeenCalled();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });
});
