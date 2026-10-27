import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  ChangeDetectionStrategy,
  inject,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { EMPTY, Subject, Subscription, of } from 'rxjs';
import { debounceTime, switchMap, catchError } from 'rxjs/operators';
import {
  LucidePlus,
  LucideX,
  LucideMessageSquare,
  LucideInfo,
  LucideMinimize2,
  LucideBookmark,
  LucideCheck,
  LucideCircleAlert,
  LucideSend,
} from '@lucide/angular';
import {
  ConversationService,
  ConversationSummary,
  ConversationDetail,
  ConversationMessage,
  ContextInspectionResult,
  CompactionPreviewResult,
} from '../../services/conversation.service';
import { PromptService, ModelMetadata } from '../../services/prompt.service';
import { generateIdempotencyKey } from '../../utils/uuid.util';
import { isUnknownOutcomeError } from '../../utils/http-retry.util';
import { toApiErrorMessage } from '../../utils/api-error.util';
import { DialogDirective } from '../../shared/a11y/dialog.directive';
import { ToastService } from '../../shared/feedback/toast.service';
import { ConfirmService } from '../../shared/feedback/confirm.service';

@Component({
  selector: 'app-conversations',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    LucidePlus,
    LucideX,
    LucideMessageSquare,
    LucideInfo,
    LucideMinimize2,
    LucideBookmark,
    LucideCheck,
    LucideCircleAlert,
    LucideSend,
    DialogDirective,
  ],
  templateUrl: './conversations.component.html',
  styleUrls: ['./conversations.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ConversationsComponent implements OnInit, OnDestroy {
  // Inventory
  conversations = signal<ConversationSummary[]>([]);
  selectedConversation = signal<ConversationDetail | null>(null);
  availableModels = signal<ModelMetadata[]>([]);
  loadingList = signal<boolean>(false);
  loadingDetail = signal<boolean>(false);
  sendingMessage = signal<boolean>(false);

  // Chat Input
  messageInput = signal<string>('');
  chatError = signal<string | null>(null);
  currentSendMessageKey: string | null = null;

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

  // Model-aware Token Counter for current message input
  private readonly tokenEstimateSubject = new Subject<{ text: string; model: string; provider?: string }>();
  private tokenEstimateSub?: Subscription;

  inputTokensCount = signal<number>(0);
  inputTokensMethod = signal<string | null>(null);

  currentInputTokensEstimate = computed(() => this.inputTokensCount());
  isEstimateApproximate = computed(() => {
    const method = this.inputTokensMethod();
    return Boolean(method && (method.startsWith('approximate:') || method.startsWith('heuristic:')));
  });

  /** Short text for the screen-reader status region. */
  liveStatus = signal('');

  private readonly toast = inject(ToastService);
  private readonly confirmService = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  /** Selection requests; switchMap keeps only the latest one's response. */
  private readonly selectSubject = new Subject<{ id: string }>();

  constructor(
    private readonly conversationService: ConversationService,
    private readonly promptService: PromptService,
  ) {
    this.selectSubject
      .pipe(
        switchMap(({ id }) =>
          this.conversationService.getConversation(id).pipe(
            catchError((err) => {
              this.loadingDetail.set(false);
              this.chatError.set(toApiErrorMessage(err, 'Failed to load conversation details.'));
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((detail) => {
        this.selectedConversation.set(detail);
        this.loadingDetail.set(false);
        this.refreshContext();
      });
  }

  ngOnInit(): void {
    this.loadModels();
    this.loadConversations();

    this.tokenEstimateSub = this.tokenEstimateSubject
      .pipe(
        debounceTime(350),
        switchMap(({ text, model, provider }) =>
          this.conversationService.estimateTokens({ text, model, provider }).pipe(
            catchError(() =>
              of({ tokens: Math.max(1, Math.ceil(text.length / 4)), method: 'heuristic:chars/4' }),
            ),
          ),
        ),
      )
      .subscribe((res) => {
        this.inputTokensCount.set(res.tokens);
        this.inputTokensMethod.set(res.method);
      });
  }

  ngOnDestroy(): void {
    this.tokenEstimateSub?.unsubscribe();
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

    this.selectSubject.next({ id });
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
          this.toast.error(toApiErrorMessage(err, 'Failed to create conversation'));
        },
      });
  }

  async deleteConversation(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    const confirmed = await this.confirmService.confirm({
      title: 'Delete conversation',
      message: 'Are you sure you want to delete this conversation?',
      confirmLabel: 'Delete',
    });
    if (!confirmed) {
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

  onMessageInputChange(val: string): void {
    this.messageInput.set(val);
    this.currentSendMessageKey = null; // Input changed -> reset key
    const trimmed = (val || '').trim();
    if (!trimmed) {
      this.inputTokensCount.set(0);
      this.inputTokensMethod.set(null);
      return;
    }
    const conv = this.selectedConversation();
    const model = conv?.model || this.newModel || 'gpt-4o';
    const provider = conv?.provider || this.newProvider;
    this.tokenEstimateSubject.next({ text: trimmed, model, provider });
  }

  sendMessage(): void {
    const text = this.messageInput().trim();
    const conv = this.selectedConversation();
    if (!text || !conv || this.sendingMessage()) {
      return;
    }

    if (!this.currentSendMessageKey) {
      this.currentSendMessageKey = generateIdempotencyKey();
    }
    const idempotencyKey = this.currentSendMessageKey;

    this.sendingMessage.set(true);
    this.chatError.set(null);
    this.liveStatus.set('');

    this.conversationService.sendMessage(conv.id, text, idempotencyKey).subscribe({
      next: (res) => {
        this.currentSendMessageKey = null; // Cleared on success!
        this.messageInput.set('');
        this.inputTokensCount.set(0);
        this.inputTokensMethod.set(null);
        this.sendingMessage.set(false);

        if (res.success) {
          this.liveStatus.set('Assistant replied');
        } else {
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
        const code = err.error?.code || err.error?.message;
        if (code === 'CONTEXT_BUDGET_EXCEEDED') {
          this.chatError.set(
            "This message plus the pinned context exceeds the conversation's budget — compact history or shorten the message.",
          );
        } else {
          this.chatError.set(toApiErrorMessage(err, 'Failed to transmit message.'));
        }
        // Keep the idempotency key only for unknown outcomes (network error, 502/503/504, 409 REQUEST_IN_PROGRESS).
        // Rotate it on every other error (reading `code` from problem-details body).
        if (!isUnknownOutcomeError(err)) {
          this.currentSendMessageKey = null;
        }
      },
    });
  }

  retrySendMessage(): void {
    this.sendMessage();
  }

  refreshContext(): void {
    const conv = this.selectedConversation();
    if (!conv) return;

    this.loadingContext.set(true);
    this.conversationService.inspectContext(conv.id).subscribe({
      next: (data) => {
        if (this.selectedConversation()?.id !== conv.id) {
          return; // A newer selection owns the context panel now.
        }
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
        this.compactionError.set(
          toApiErrorMessage(err, 'Failed to generate compaction preview.'),
        );
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
        this.compactionError.set(toApiErrorMessage(err, 'Invalid sequence target for compaction.'));
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
          this.compactionError.set(
            toApiErrorMessage(err, 'Failed to apply compaction checkpoint.'),
          );
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
        this.toast.error(toApiErrorMessage(err, 'Failed to resume from checkpoint'));
      },
    });
  }

  isMessageCompacted(seq: number): boolean {
    const cp = this.selectedConversation()?.activeCheckpoint;
    if (!cp) return false;
    return seq <= cp.compactedThroughSequence;
  }
}
