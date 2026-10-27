import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideLock } from '@lucide/angular';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, LucideLock],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  tokenInput = '';
  errorMessage = '';

  onSubmit(): void {
    const trimmed = this.tokenInput.trim();
    if (!trimmed) {
      this.errorMessage = 'Please enter an API Key or Bearer Token.';
      return;
    }

    this.errorMessage = '';
    this.authService.setToken(trimmed);
    this.router.navigate(['/']);
  }
}
