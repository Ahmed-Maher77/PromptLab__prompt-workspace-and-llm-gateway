import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  ConversationService,
  ConversationSummary,
  ConversationDetail,
  ConversationMessage,
  ContextInspectionResult,
  CompactionPreviewResult,
} from '../../services/conversation.service';
import { PromptService, ModelMetadata } from '../../services/prompt.service';

@Component({
  selector: 'app-conversations',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './conversations.component.html',
  styleUrls: ['./conversations.component.css'],
})
export class ConversationsComponent implements OnInit {
  // Inventory
  conversations = signal<ConversationSummary[]>([]);
  selectedConversation = signal<ConversationDetail | null>(null);
  availableModels = signal<ModelMetadata[]>([]);
  loadingList = signal<boolean>(false);
  loadingDetail = signal<boolean>(false);
  sendingMessage = signal<boolean>(false);

  // Chat Input
  messageInput = '';
  chatError = signal<string | null>(null);

  // New Conversation Modal
  showNewModal = signal<boolean>(false);
  newTitle = '';
  newProvider = 'openai';
  newModel = 'gpt-4o-mini';
  newSystemPrompt = 'You are a knowledgeable and concise technical software assistant.';
  creatingConversation = signal<boolean>(false);

  // Context Inspector Drawer/Modal
  showContextModal = signal<boolean>(false);
  contextData = signal<ContextInspectionResult | null>(null);
  loadingContext = signal<boolean>(false);

  // Compaction Modal
  showCompactModal = signal<boolean>(false);
  compactPreview = signal<CompactionPreviewResult | null>(null);
  loadingPreview = signal<boolean>(false);
  applyingCompaction = signal<boolean>(false);
  compactionError = signal<string | null>(null);
  targetSequence = 0;
  editableSummary = '';
  editableFactsText = '';

  // Resume / History drawer
  showHistoryDrawer = signal<boolean>(false);
  resumeMessage = signal<string | null>(null);

  // Computed Token Counter for current message input
  currentInputTokensEstimate = computed(() => {
    const text = this.messageInput || '';
    if (!text.trim()) return 0;
    return Math.max(1, Math.ceil(text.length / 3.8));
  });

  constructor(
    private readonly conversationService: ConversationService,
    private readonly promptService: PromptService,
  ) {}

  ngOnInit(): void {
    this.loadModels();
    this.loadConversations();
  }

  loadModels(): void {
    this.promptService.getModels().subscribe({
      next: (res) => {
        const models = res.models || [];
        this.availableModels.set(models);
        if (models.length > 0) {
          this.newModel = models[0].id;
          this.newProvider = models[0].provider;
        }
      },
    });
  }

  loadConversations(autoSelectId?: string): void {
    this.loadingList.set(true);
    this.conversationService.getConversations().subscribe({
      next: (list) => {
        this.conversations.set(list);
        this.loadingList.set(false);

        if (autoSelectId) {
          this.selectConversation(autoSelectId);
        } else if (!this.selectedConversation() && list.length > 0) {
          this.selectConversation(list[0].id);
        }
      },
      error: () => {
        this.loadingList.set(false);
      },
    });
  }

  selectConversation(id: string, preserveNotification = false): void {
    this.loadingDetail.set(true);
    if (!preserveNotification) {
      this.chatError.set(null);
      this.resumeMessage.set(null);
    }

    this.conversationService.getConversation(id).subscribe({
      next: (detail) => {
        this.selectedConversation.set(detail);
        this.loadingDetail.set(false);
        this.refreshContext();
      },
      error: (err) => {
        this.loadingDetail.set(false);
        this.chatError.set(err.error?.message || 'Failed to load conversation details.');
      },
    });
  }

  onModelChange(modelId: string): void {
    this.newModel = modelId;
    const m = this.availableModels().find((x) => x.id === modelId);
    if (m) {
      this.newProvider = m.provider;
    }
  }

  openNewModal(): void {
    this.newTitle = 'New Conversation';
    this.showNewModal.set(true);
  }

  closeNewModal(): void {
    this.showNewModal.set(false);
  }

  createNewConversation(): void {
    this.creatingConversation.set(true);
    this.conversationService
      .createConversation({
        title: this.newTitle.trim() || undefined,
        provider: this.newProvider,
        model: this.newModel,
        systemPrompt: this.newSystemPrompt.trim() || undefined,
      })
      .subscribe({
        next: (created) => {
          this.creatingConversation.set(false);
          this.showNewModal.set(false);
          this.loadConversations(created.id);
        },
        error: (err) => {
          this.creatingConversation.set(false);
          alert(err.error?.message || 'Failed to create conversation');
        },
      });
  }

  deleteConversation(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this conversation?')) {
      return;
    }

    this.conversationService.deleteConversation(id).subscribe({
      next: () => {
        if (this.selectedConversation()?.id === id) {
          this.selectedConversation.set(null);
          this.contextData.set(null);
        }
        this.loadConversations();
      },
    });
  }

  sendMessage(): void {
    const text = this.messageInput.trim();
    const conv = this.selectedConversation();
    if (!text || !conv || this.sendingMessage()) {
      return;
    }

    this.sendingMessage.set(true);
    this.chatError.set(null);

    this.conversationService.sendMessage(conv.id, text).subscribe({
      next: (res) => {
        this.messageInput = '';
        this.sendingMessage.set(false);

        if (!res.success) {
          this.chatError.set(
            `[${res.errorType || 'PROVIDER_ERROR'}] ${res.errorMessage}` +
              (res.configurationHint ? ` (${res.configurationHint})` : ''),
          );
        }

        // Reload conversation detail to update transcript and context statistics while preserving error notification
        this.selectConversation(conv.id, true);
      },
      error: (err) => {
        this.sendingMessage.set(false);
        this.chatError.set(err.error?.message || 'Failed to transmit message.');
      },
    });
  }

  refreshContext(): void {
    const conv = this.selectedConversation();
    if (!conv) return;

    this.loadingContext.set(true);
    this.conversationService.inspectContext(conv.id).subscribe({
      next: (data) => {
        this.contextData.set(data);
        this.loadingContext.set(false);
      },
      error: () => {
        this.loadingContext.set(false);
      },
    });
  }

  openContextModal(): void {
    this.refreshContext();
    this.showContextModal.set(true);
  }

  closeContextModal(): void {
    this.showContextModal.set(false);
  }

  // --- Manual Compaction Methods ---

  openCompactModal(): void {
    const conv = this.selectedConversation();
    if (!conv) return;

    this.compactionError.set(null);
    this.loadingPreview.set(true);
    this.showCompactModal.set(true);

    this.conversationService.previewCompaction(conv.id).subscribe({
      next: (preview) => {
        this.compactPreview.set(preview);
        this.targetSequence = preview.compactThroughSequence;
        this.editableSummary = preview.proposedSummary;
        this.editableFactsText = preview.proposedRetainedFacts.join('\n');
        this.loadingPreview.set(false);
      },
      error: (err) => {
        this.loadingPreview.set(false);
        this.compactionError.set(err.error?.message || 'Failed to generate compaction preview.');
      },
    });
  }

  onTargetSequenceChange(): void {
    const conv = this.selectedConversation();
    if (!conv) return;

    this.loadingPreview.set(true);
    this.compactionError.set(null);

    this.conversationService.previewCompaction(conv.id, this.targetSequence).subscribe({
      next: (preview) => {
        this.compactPreview.set(preview);
        this.editableSummary = preview.proposedSummary;
        this.editableFactsText = preview.proposedRetainedFacts.join('\n');
        this.loadingPreview.set(false);
      },
      error: (err) => {
        this.loadingPreview.set(false);
        this.compactionError.set(err.error?.message || 'Invalid sequence target for compaction.');
      },
    });
  }

  applyCompaction(): void {
    const conv = this.selectedConversation();
    if (!conv || !this.editableSummary.trim()) return;

    this.applyingCompaction.set(true);
    this.compactionError.set(null);

    const facts = this.editableFactsText
      .split('\n')
      .map((line) => line.replace(/^[-*•\d.]\s*/, '').trim())
      .filter((line) => line.length > 0);

    this.conversationService
      .applyCompaction(conv.id, {
        summary: this.editableSummary.trim(),
        retainedFacts: facts,
        compactedThroughSequence: this.targetSequence,
      })
      .subscribe({
        next: () => {
          this.applyingCompaction.set(false);
          this.showCompactModal.set(false);
          this.selectConversation(conv.id);
        },
        error: (err) => {
          this.applyingCompaction.set(false);
          this.compactionError.set(err.error?.message || 'Failed to apply compaction checkpoint.');
        },
      });
  }

  closeCompactModal(): void {
    this.showCompactModal.set(false);
  }

  // --- Resume & Checkpoint History Methods ---

  toggleHistoryDrawer(): void {
    this.showHistoryDrawer.set(!this.showHistoryDrawer());
  }

  resumeCheckpoint(checkpointId: string): void {
    const conv = this.selectedConversation();
    if (!conv) return;

    this.conversationService.resume(conv.id, checkpointId).subscribe({
      next: (res) => {
        this.resumeMessage.set(
          `Resumed from checkpoint #${checkpointId.slice(0, 8)}. ` +
            `Active context now uses this checkpoint summary + messages after sequence #${res.activeCheckpoint?.compactedThroughSequence}. ` +
            `All ${res.originalMessagesRetained} original messages remain safely stored in PostgreSQL.`,
        );
        this.showHistoryDrawer.set(false);
        this.selectConversation(conv.id, true);
      },
      error: (err) => {
        alert(err.error?.message || 'Failed to resume from checkpoint');
      },
    });
  }

  isMessageCompacted(seq: number): boolean {
    const cp = this.selectedConversation()?.activeCheckpoint;
    if (!cp) return false;
    return seq <= cp.compactedThroughSequence;
  }
}
