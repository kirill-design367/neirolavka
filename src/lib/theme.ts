export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'neirolavka-theme';

/**
 * Скрипт, который выполняется в <head> ДО первой отрисовки.
 * Он ставит data-theme на <html>, поэтому браузер сразу красит страницу
 * в нужную тему и вспышки чужого фона не бывает.
 *
 * Никаких зависимостей: строка вставляется как есть в dangerouslySetInnerHTML.
 * Тема по умолчанию — светлая, системная не учитывается намеренно:
 * в брифе светлая назначена дефолтом.
 */
export const themeInitScript = `(function(){try{
var k=${JSON.stringify(THEME_STORAGE_KEY)};
var t=localStorage.getItem(k);
if(t!=='light'&&t!=='dark')t='light';
var e=document.documentElement;
e.dataset.theme=t;
e.style.colorScheme=t;
}catch(_){document.documentElement.dataset.theme='light';}})();`;
