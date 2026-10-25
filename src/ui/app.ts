// 画面の切り替えとセーブの紐づけ
import type { Nav } from './nav';
import { mainScreen } from './screens/main';
import { resultScreen } from './screens/result';
import { setupScreen } from './screens/setup';
import { titleScreen } from './screens/title';
import { finishLife, saveGame } from './storage';

export function startApp(root: HTMLElement): Nav {
  const nav: Nav = {
    title: () => titleScreen(root, nav),
    setup: (seed) => setupScreen(root, nav, seed),
    main: (state) => {
      saveGame(state); // 始めた直後から「続きから」で戻れるように
      mainScreen(root, nav, state, { onYearEnd: (s) => saveGame(s) });
    },
    result: (state) => {
      finishLife(state); // セーブを消して過去の人生に記録
      resultScreen(root, nav, state);
    },
  };
  nav.title();
  return nav;
}
