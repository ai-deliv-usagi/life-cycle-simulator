// 画面の切り替え
import type { Nav } from './nav';
import { mainScreen } from './screens/main';
import { resultScreen } from './screens/result';
import { setupScreen } from './screens/setup';
import { titleScreen } from './screens/title';

export function startApp(root: HTMLElement): Nav {
  const nav: Nav = {
    title: () => titleScreen(root, nav),
    setup: (seed) => setupScreen(root, nav, seed),
    main: (state) => mainScreen(root, nav, state),
    result: (state) => resultScreen(root, nav, state),
  };
  nav.title();
  return nav;
}
