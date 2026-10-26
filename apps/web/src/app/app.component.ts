import { Component, ChangeDetectionStrategy } from '@angular/core';
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
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AppComponent {
  title = 'PromptLab';
  sidebarCollapsed = window.matchMedia('(max-width: 520px)').matches;

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }
}
