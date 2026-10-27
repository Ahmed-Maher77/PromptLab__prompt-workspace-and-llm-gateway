import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer, switchMap } from 'rxjs';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideMenu,
  LucideLayoutDashboard,
  LucideSquarePen,
  LucideSlidersHorizontal,
  LucideMessageSquare,
  LucideClock,
  LucideActivity,
  LucideSettings,
} from '@lucide/angular';
import { HealthService } from './services/health.service';
import { ToastComponent } from './shared/feedback/toast.component';
import { ConfirmDialogComponent } from './shared/feedback/confirm-dialog.component';

export type GatewayState = 'checking' | 'online' | 'unreachable';

const HEALTH_POLL_INTERVAL_MS = 30_000;
const DEFAULT_DISPLAY_NAME = 'Developer';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucideMenu,
    LucideLayoutDashboard,
    LucideSquarePen,
    LucideSlidersHorizontal,
    LucideMessageSquare,
    LucideClock,
    LucideActivity,
    LucideSettings,
    ToastComponent,
    ConfirmDialogComponent,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AppComponent {
  private readonly healthService = inject(HealthService);
  private readonly destroyRef = inject(DestroyRef);

  title = 'PromptLab';
  // The web app has no user profile yet, so the avatar uses the generic workspace user.
  readonly displayName = DEFAULT_DISPLAY_NAME;
  readonly gatewayState = signal<GatewayState>('checking');
  readonly gatewayLabel = computed(() => {
    switch (this.gatewayState()) {
      case 'online':
        return 'Gateway online';
      case 'unreachable':
        return 'Gateway unreachable';
      default:
        return 'Checking…';
    }
  });
  readonly initials = 'DV';
  sidebarCollapsed = window.matchMedia('(max-width: 520px)').matches;

  constructor() {
    timer(0, HEALTH_POLL_INTERVAL_MS)
      .pipe(
        switchMap(() => this.healthService.getHealth()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((health) => {
        this.gatewayState.set(
          health?.services?.gateway?.serviceAvailability === 'available' ? 'online' : 'unreachable',
        );
      });
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }
}
