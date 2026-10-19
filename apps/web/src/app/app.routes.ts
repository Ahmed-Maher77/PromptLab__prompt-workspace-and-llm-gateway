import { Routes } from '@angular/router';
import { OverviewComponent } from './pages/overview/overview.component';

export const routes: Routes = [
  { path: '', component: OverviewComponent, title: 'Overview — PromptLab' },
  { path: '**', redirectTo: '' },
];
