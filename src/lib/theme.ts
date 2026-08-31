export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'neirolavka-theme';

/** Должно совпадать с --theme-dur в globals.css. */
export const THEME_TRANSITION_MS = 380;

/**
 * Цвет строки браузера для каждой темы. Он обязан следовать за темой
 * САЙТА, а не за системной: пока здесь стоял media-запрос
 * prefers-color-scheme, на телефоне с тёмной системой строка уходила
 * в тёмный над светлой страницей — и сайт читался открывшимся тёмным.
 * Это было единственное место, где системная тема вообще учитывалась.
 */
export const THEME_BAR: Record<Theme, string> = {
  light: '#f4dbc5',
  dark: '#0c2223',
};

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
var bar=${JSON.stringify(THEME_BAR)};
var t=localStorage.getItem(k);
if(t!=='light'&&t!=='dark')t='light';
var e=document.documentElement;
e.dataset.theme=t;
e.style.colorScheme=t;
var m=document.querySelector('meta[name="theme-color"]');
if(!m){m=document.createElement('meta');m.name='theme-color';e.appendChild(m);}
m.setAttribute('content',bar[t]);
}catch(_){document.documentElement.dataset.theme='light';}})();`;
