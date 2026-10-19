import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HealthService, HealthResponse } from '../../services/health.service';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.css'],
})
export class OverviewComponent implements OnInit {
  healthData: HealthResponse | null = null;
  isLoading = true;
  lastChecked: Date = new Date();

  constructor(private healthService: HealthService) {}

  ngOnInit(): void {
    this.refreshHealth();
  }

  refreshHealth(): void {
    this.isLoading = true;
    this.healthService.getHealth().subscribe({
      next: (data) => {
        this.healthData = data;
        this.isLoading = false;
        this.lastChecked = new Date();
      },
      error: () => {
        this.healthData = null;
        this.isLoading = false;
        this.lastChecked = new Date();
      },
    });
  }
}
