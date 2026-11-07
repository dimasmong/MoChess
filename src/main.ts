import './styles/main.css';
import { ChessGameEngine } from './engine/ChessGameEngine';
import type { Square } from './engine/types';
import { SceneManager } from './scene/SceneManager';
import { UIManager } from './ui/UIManager';
import { aiManager } from './ai/AIManager';
import { soundManager, type SoundManager } from './audio/SoundManager';
import { onlineClient, type OnlineMultiplayerClient } from './online/OnlineMultiplayerClient';

declare global {
  interface Window {
    __wizardChess?: {
      engine: ChessGameEngine;
      scene: SceneManager;
      ui: UIManager;
      online: OnlineMultiplayerClient;
      sound: SoundManager;
      triggerAIMove: () => Promise<void>;
    };
  }
}

function bootstrap(): void {
  const container = document.getElementById('canvas-container');
  if (!container) {
    throw new Error('Missing #canvas-container element');
  }

  const engine = new ChessGameEngine({
    mode: 'ai',
    playerColor: 'w',
    aiDifficulty: 'knight',
    timeControlMinutes: 0,
    mapId: 'cathedral'
  });

  // Restore saved match on page refresh if available
  const restored = engine.restoreFromStorage();
  if (restored && engine.isGameOver()) {
    engine.restart();
  }

  let aiRequestToken = 0;

  const scene = new SceneManager(
    container,
    (square: Square) => {
      handleBoardSquareTap(square);
    },
    undefined,
    engine.getConfig().mapId ?? 'cathedral'
  );

  const triggerAIMove = async (): Promise<void> => {
    if (engine.isGameOver() || engine.getConfig().mode === 'online' || !engine.isAITurn()) return;
    const token = ++aiRequestToken;
    ui.setAIThinking(true);

    const fen = engine.getFen();
    const diff = engine.getConfig().aiDifficulty;

    try {
      // Natural pacing delay so human move / combat animation completes cleanly
      await new Promise((r) => setTimeout(r, 340));
      if (token !== aiRequestToken || engine.isGameOver() || engine.getFen() !== fen || !engine.isAITurn()) {
        return;
      }

      const bestMove = await aiManager.computeBestMove(fen, diff);
      if (token !== aiRequestToken || engine.isGameOver() || engine.getFen() !== fen || !engine.isAITurn()) {
        return;
      }

      if (bestMove && !engine.isGameOver()) {
        const result = engine.executeMove(bestMove.from, bestMove.to, bestMove.promotion ?? 'q');
        if (result.valid && result.move) {
          soundManager.playForMove(result.move);
        }
      }
    } finally {
      if (token === aiRequestToken) {
        ui.setAIThinking(false);
      }
    }
  };

  const ui = new UIManager(engine, scene, () => {
    void triggerAIMove();
  });

  function handleBoardSquareTap(square: Square): void {
    // Disallow board interaction when game is over or main menu is open
    if (engine.isGameOver() || ui.isMainMenuVisible()) {
      return;
    }

    // In Single Player vs AI mode, disallow moving during AI's turn and ensure AI is triggered if idle
    if (engine.isAITurn()) {
      ui.showTurnOrBlockedFeedback('ai_thinking');
      if (!aiManager.isThinking()) {
        void triggerAIMove();
      }
      return;
    }

    // In Online PvP mode, enforce waiting-for-opponent and turn ownership with clear feedback
    if (engine.getConfig().mode === 'online') {
      const onlineSnap = onlineClient.getSnapshot();
      if (
        (onlineSnap.active && onlineSnap.room && onlineSnap.room.status === 'waiting') ||
        engine.getConfig().onlineStatus === 'waiting'
      ) {
        ui.showTurnOrBlockedFeedback('waiting_opponent');
        return;
      }
      if (!engine.isHumanTurn()) {
        ui.showTurnOrBlockedFeedback(
          engine.getTurn() === 'w' ? 'opponent_turn_w' : 'opponent_turn_b'
        );
        return;
      }
    }

    const res = engine.handleSquareInteraction(square);
    if ('action' in res) {
      if (res.action === 'selected') {
        soundManager.playSelect();
        if (res.destinations.length === 0) {
          const reason = engine.getNoMovesReason(square);
          if (reason) {
            ui.showTurnOrBlockedFeedback(reason);
          }
        } else {
          ui.hideFeedbackToast();
        }
      }
      return;
    }

    if (res.requiresPromotion) {
      soundManager.playSelect();
      ui.hideFeedbackToast();
      ui.showPromotionModal(true);
      return;
    }

    if (res.valid && res.move) {
      ui.hideFeedbackToast();
      soundManager.playForMove(res.move);
      if (engine.getConfig().mode === 'online') {
        void onlineClient
          .submitMove(res.move.from, res.move.to, res.move.promotion)
          .then((onlineRes) => {
            if (!onlineRes.ok) {
              engine.undo(true);
            }
          });
      } else if (!engine.isGameOver() && engine.isAITurn()) {
        void triggerAIMove();
      }
    }
  }

  engine.subscribe((snapshot, lastMove) => {
    scene.syncWithSnapshot(snapshot, lastMove);
    ui.updateFromSnapshot(snapshot, lastMove);
  });

  // Chess clock tick loop
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const delta = now - lastTick;
    lastTick = now;
    if (!ui.isMainMenuVisible() && !scene.isOpeningCinematicPlaying()) {
      engine.tickClock(delta);
      if (engine.getSnapshot().clock.enabled) {
        ui.updateFromSnapshot(engine.getSnapshot());
      }
    }
  }, 250);

  // Check URL parameters for ?room=XXXXXX or ?autostart=1
  const params = new URLSearchParams(window.location.search);
  const urlRoomCode = params.get('room')?.trim();
  const savedActiveRoom = onlineClient.getSavedActiveRoomCode();

  if (urlRoomCode) {
    void ui.joinOnlineRoomFromUrl(urlRoomCode);
  } else if (savedActiveRoom) {
    void ui.joinOnlineRoomFromUrl(savedActiveRoom);
  } else if (params.get('autostart') === '1') {
    ui.showMainMenu(false);
    if (engine.isAITurn()) {
      void triggerAIMove();
    }
  } else {
    ui.showMainMenu(true);
  }

  window.__wizardChess = {
    engine,
    scene,
    ui,
    online: onlineClient,
    sound: soundManager,
    triggerAIMove
  };
}

bootstrap();
