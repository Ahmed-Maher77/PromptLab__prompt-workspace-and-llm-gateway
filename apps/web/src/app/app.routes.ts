import { Routes } from '@angular/router';
import { OverviewComponent } from './pages/overview/overview.component';
import { PromptStudioComponent } from './pages/prompt-studio/prompt-studio.component';
import { CompareComponent } from './pages/compare/compare.component';
import { ConversationsComponent } from './pages/conversations/conversations.component';
import { UsageComponent } from './pages/usage/usage.component';

export const routes: Routes = [
  { path: '', component: OverviewComponent, title: 'Overview — PromptLab' },
  { path: 'prompt-studio', component: PromptStudioComponent, title: 'Prompt Studio — PromptLab' },
  { path: 'compare', component: CompareComponent, title: 'Compare — PromptLab' },
  { path: 'conversations', component: ConversationsComponent, title: 'Conversations — PromptLab' },
  { path: 'usage', component: UsageComponent, title: 'Usage & Quotas — PromptLab' },
  { path: '**', redirectTo: '' },
];
