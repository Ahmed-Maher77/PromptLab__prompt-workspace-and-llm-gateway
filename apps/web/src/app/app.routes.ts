import { Routes } from '@angular/router';
import { OverviewComponent } from './pages/overview/overview.component';

export const routes: Routes = [
  { path: '', component: OverviewComponent, title: 'Overview — PromptLab' },
  {
    path: 'prompt-studio',
    loadComponent: () =>
      import('./pages/prompt-studio/prompt-studio.component').then((m) => m.PromptStudioComponent),
    title: 'Prompt Studio — PromptLab',
  },
  {
    path: 'compare',
    loadComponent: () =>
      import('./pages/compare/compare.component').then((m) => m.CompareComponent),
    title: 'Compare — PromptLab',
  },
  {
    path: 'conversations',
    loadComponent: () =>
      import('./pages/conversations/conversations.component').then((m) => m.ConversationsComponent),
    title: 'Conversations — PromptLab',
  },
  {
    path: 'usage',
    loadComponent: () =>
      import('./pages/usage/usage.component').then((m) => m.UsageComponent),
    title: 'Usage & Quotas — PromptLab',
  },
  {
    path: 'observability',
    loadComponent: () =>
      import('./pages/observability/observability.component').then((m) => m.ObservabilityComponent),
    title: 'Observability & Traces — PromptLab',
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
    title: 'Settings — PromptLab',
  },
  { path: '**', redirectTo: '' },
];
