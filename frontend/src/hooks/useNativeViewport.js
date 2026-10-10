import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

// The visible WebView can shrink independently of the layout viewport (keyboard
// or pinch zoom). Reflow the native shell inside that visible rectangle.
export function useNativeViewport() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const viewport = window.visualViewport;
    const style = document.documentElement.style;
    const properties = ['--app-viewport-width', '--app-viewport-height', '--app-viewport-top', '--app-viewport-left'];
    let frame;
    let availableHeight = viewport?.height ?? window.innerHeight;
    let availableScale = viewport?.scale ?? 1;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const values = [viewport?.width ?? window.innerWidth, viewport?.height ?? window.innerHeight,
          viewport?.offsetTop ?? 0, viewport?.offsetLeft ?? 0];
        const scale = viewport?.scale ?? 1;
        const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
        if (!typing) {
          availableHeight = values[1];
          availableScale = scale;
        }
        const expectedHeight = availableHeight * availableScale / scale;
        document.documentElement.dataset.nativeKeyboard = String(typing && expectedHeight - values[1] > 100);
        properties.forEach((property, index) => style.setProperty(property, `${values[index]}px`));
      });
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      delete document.documentElement.dataset.nativeKeyboard;
      properties.forEach(property => style.removeProperty(property));
    };
  }, []);
}
