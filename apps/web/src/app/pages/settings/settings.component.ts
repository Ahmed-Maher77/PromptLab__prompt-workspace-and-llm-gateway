import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SettingsService, SystemSettings } from '../../services/settings.service';

@Component({
  selector: 'app-settings',
  imports: [CommonModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
})
export class SettingsComponent implements OnInit {
  settings: SystemSettings | null = null;
  loading = false;
  errorMessage: string | null = null;

  constructor(private readonly settingsService: SettingsService) {}

  ngOnInit(): void {
    this.loadSettings();
  }

  loadSettings(): void {
    this.loading = true;
    this.errorMessage = null;

    this.settingsService.getSettings().subscribe({
      next: (data) => {
        this.settings = data;
        this.loading = false;
      },
      error: (err) => {
        this.errorMessage =
          err?.error?.message ||
          'Failed to retrieve system settings. Please ensure the backend API is running.';
        this.loading = false;
      },
    });
  }

  formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }
}
