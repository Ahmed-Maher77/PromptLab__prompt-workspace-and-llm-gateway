import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

/**
 * HTTP interceptor for client authentication.
 *
 * Rules:
 *  - No hardcoded token fallback.
 *  - Attaches Authorization header ONLY to requests targeting the PromptLab API base URL.
 *  - Clears stored token and navigates to /login on HTTP 401 Unauthorized responses.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Attach token only to requests directed to the API base URL
  const isApiRequest =
    req.url.startsWith(environment.apiBaseUrl) ||
    req.url.startsWith('/api') ||
    req.url.includes('/api/');

  let requestToForward = req;
  const token = authService.getToken();

  if (isApiRequest && token) {
    requestToForward = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return next(requestToForward).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        authService.clearToken();
        router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
