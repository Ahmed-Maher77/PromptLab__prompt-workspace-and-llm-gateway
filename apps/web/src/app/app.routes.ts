import { Routes } from '@angular/router';
import { OverviewComponent } from './pages/overview/overview.component';

import { PromptStudioComponent } from './pages/prompt-studio/prompt-studio.component';

export const routes: Routes = [
  { path: '', component: OverviewComponent, title: 'Overview — PromptLab' },
  { path: 'prompt-studio', component: PromptStudioComponent, title: 'Prompt Studio — PromptLab' },
  { path: '**', redirectTo: '' },
];
