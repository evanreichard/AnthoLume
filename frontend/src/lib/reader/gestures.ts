import type { EpubContents, EpubRendition } from './types';

export interface GestureHandlers {
  isPaginationDisabled: () => boolean;
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;
  onSwipeDown: () => void;
  onSwipeUp: () => void;
  onCenterTap: () => void;
}

const WHEEL_COOLDOWN_MS = 400;
const SWIPE_THRESHOLD = 25;

/**
 * Registers touch / click-zone / wheel listeners on every rendered section. Returns a dispose
 * (called from EBookReader.destroy) that clears the pending wheel-cooldown timeout and removes
 * every listener added across rendered sections, so they don't accumulate on re-render.
 */
export function registerRenditionGestures(
  rendition: EpubRendition,
  handlers: GestureHandlers
): () => void {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;
  let wheelTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const listenerCleanups: Array<() => void> = [];

  const resetWheelCooldown = () => {
    if (wheelTimeoutId) {
      clearTimeout(wheelTimeoutId);
    }
    wheelTimeoutId = setTimeout(() => {
      wheelTimeoutId = null;
    }, WHEEL_COOLDOWN_MS);
  };

  const handleSwipeDown = () => {
    resetWheelCooldown();
    handlers.onSwipeDown();
  };

  const handleSwipeUp = () => {
    resetWheelCooldown();
    handlers.onSwipeUp();
  };

  const handleGesture = () => {
    const drasticity = 50;

    if (touchEndY - drasticity > touchStartY) {
      return handleSwipeDown();
    }

    if (touchEndY + drasticity < touchStartY) {
      return handleSwipeUp();
    }

    if (!handlers.isPaginationDisabled() && touchEndX + drasticity < touchStartX) {
      void handlers.nextPage();
    }

    if (!handlers.isPaginationDisabled() && touchEndX - drasticity > touchStartX) {
      void handlers.prevPage();
    }
  };

  rendition.hooks.render.register((contents: EpubContents) => {
    const renderDoc = contents.document;

    const onWakeLock = () => {
      renderDoc.dispatchEvent(new CustomEvent('wakelock'));
    };

    const onClick = (event: MouseEvent) => {
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const barPixels = windowHeight * 0.2;
      const pagePixels = windowWidth * 0.2;
      const top = barPixels;
      const bottom = window.innerHeight - top;
      const left = pagePixels;
      const right = windowWidth - left;
      const leftOffset = rendition.views().container.scrollLeft;
      const yCoord = event.clientY;
      const xCoord = event.clientX - leftOffset;

      if (yCoord < top) {
        handleSwipeDown();
      } else if (yCoord > bottom) {
        handleSwipeUp();
      } else if (!handlers.isPaginationDisabled() && xCoord < left) {
        void handlers.prevPage();
      } else if (!handlers.isPaginationDisabled() && xCoord > right) {
        void handlers.nextPage();
      } else {
        handlers.onCenterTap();
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (wheelTimeoutId) {
        return;
      }

      if (event.deltaY > SWIPE_THRESHOLD) {
        handleSwipeUp();
        return;
      }
      if (event.deltaY < -SWIPE_THRESHOLD) {
        handleSwipeDown();
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      touchStartX = event.changedTouches[0]?.screenX ?? 0;
      touchStartY = event.changedTouches[0]?.screenY ?? 0;
    };

    const onTouchEnd = (event: TouchEvent) => {
      touchEndX = event.changedTouches[0]?.screenX ?? 0;
      touchEndY = event.changedTouches[0]?.screenY ?? 0;
      handleGesture();
    };

    renderDoc.addEventListener('click', onWakeLock);
    renderDoc.addEventListener('gesturechange', onWakeLock);
    renderDoc.addEventListener('touchstart', onWakeLock);
    renderDoc.addEventListener('click', onClick);
    renderDoc.addEventListener('wheel', onWheel);
    renderDoc.addEventListener('touchstart', onTouchStart);
    renderDoc.addEventListener('touchend', onTouchEnd);

    listenerCleanups.push(() => {
      renderDoc.removeEventListener('click', onWakeLock);
      renderDoc.removeEventListener('gesturechange', onWakeLock);
      renderDoc.removeEventListener('touchstart', onWakeLock);
      renderDoc.removeEventListener('click', onClick);
      renderDoc.removeEventListener('wheel', onWheel);
      renderDoc.removeEventListener('touchstart', onTouchStart);
      renderDoc.removeEventListener('touchend', onTouchEnd);
    });
  });

  return () => {
    if (wheelTimeoutId) {
      clearTimeout(wheelTimeoutId);
      wheelTimeoutId = null;
    }
    listenerCleanups.forEach(cleanup => cleanup());
    listenerCleanups.length = 0;
  };
}
