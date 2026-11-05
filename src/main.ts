import './styles/main.css';
import { ChessGameEngine } from './engine/ChessGameEngine';
import type { Square } from './engine/types';
import { SceneManager } from './scene/SceneManager';
import { UIManager } from './ui/UIManager';
import { aiManager } from './ai/AIManager';
import { soundManager } from './audio/SoundManager';

declare global {
  interface Window {
    __wizardChess?: {
      engine: ChessGameEngine;
      scene: SceneManager;
      ui: UIManager;
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
    if (engine.isGameOver()) return;
    const token = ++aiRequestToken;
    ui.setAIThinking(true);

    const fen = engine.getFen();
    const diff = engine.getConfig().aiDifficulty;

    // Natural pacing delay so human move / combat animation completes cleanly
    await new Promise((r) => setTimeout(r, 340));
    if (token !== aiRequestToken || engine.isGameOver() || engine.getFen() !== fen) {
      ui.setAIThinking(false);
      return;
    }

    const bestMove = await aiManager.computeBestMove(fen, diff);
    if (token !== aiRequestToken || engine.isGameOver() || engine.getFen() !== fen) {
      ui.setAIThinking(false);
      return;
    }

    ui.setAIThinking(false);
    if (bestMove && !engine.isGameOver()) {
      const result = engine.executeMove(bestMove.from, bestMove.to, bestMove.promotion ?? 'q');
      if (result.valid && result.move) {
        soundManager.playForMove(result.move);
      }
    }
  };

  const ui = new UIManager(engine, scene, () => {
    void triggerAIMove();
  });

  function handleBoardSquareTap(square: Square): void {
    // Disallow board interaction when game is over, main menu is open, or AI is computing
    if (engine.isGameOver() || ui.isMainMenuVisible()) {
      return;
    }
    if (engine.isAITurn() && aiManager.isThinking()) {
      return;
    }

    const res = engine.handleSquareInteraction(square);
    if ('action' in res) {
      if (res.action === 'selected') {
        soundManager.playSelect();
      }
      return;
    }

    if (res.requiresPromotion) {
      soundManager.playSelect();
      ui.showPromotionModal(true);
      return;
    }

    if (res.valid && res.move) {
      soundManager.playForMove(res.move);
      if (!engine.isGameOver() && engine.isAITurn()) {
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

  // Show Front-End Main Menu by default unless ?autostart=1 is specified
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') {
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
    triggerAIMove
  };
}

bootstrap();
