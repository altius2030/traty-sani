import { autoUpdater } from 'electron-updater';

/**
 * Обновление приложения.
 *
 * Логика живёт в главном процессе, а интерфейс только показывает состояние:
 * так загрузка продолжает качаться, даже если окно перерисовалось.
 *
 * Канал обновлений — GitHub Releases: electron-updater читает из корня
 * релиза latest.yml, а сам установщик лежит рядом с ним. Публикуется только
 * сборка по тегу: обычные сборки из ветки main публикуются лишь как
 * артефакты, иначе установленные копии начали бы предлагать себе сборку
 * из ветки.
 *
 * Про macOS. Автообновление там устроено иначе: Squirrel.Mac сверяет
 * «designated requirement» новой сборки с требованием уже установленной
 * программы, а у подписи ad-hoc отпечаток меняется при каждой сборке,
 * поэтому требования никогда не совпадут. Без устойчивой подписи обновление
 * не установится, поэтому на macOS проверка не выполняется вовсе, а
 * пользователю предлагается скачать образ вручную.
 */

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  /** Процент загрузки 0–100, заполняется только в состоянии downloading */
  percent?: number;
  transferred?: number;
  total?: number;
  /** Версия, которую предлагает сервер */
  version?: string;
  /** Текст для показа пользователю; при ошибке — сама причина */
  message?: string;
  /** Можно ли обновиться прямо сейчас на этой платформе */
  canInstall: boolean;
  /** Ссылка на релиз для ручной установки, если автоустановка недоступна */
  downloadUrl?: string;
}

const REPO = 'altius2030/traty-sani';
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;

/**
 * Поддерживается ли автообновление на этой платформе.
 *
 * На Windows установщик NSIS обновляется тихо, подпись не требуется.
 * На macOS автообновление отключено: Squirrel.Mac требует, чтобы подпись
 * обновления удовлетворяла требованию уже установленной программы, а при
 * подписи ad-hoc это невозможно. Поэтому проверка на macOS не ходит в сеть,
 * а пользователю предлагается скачать образ вручную.
 */
export function supportsAutoUpdate(): boolean {
  return process.platform !== 'darwin';
}

/** Текст для macOS вместо проверки обновлений */
export const MANUAL_UPDATE_HINT =
  'На macOS обновления устанавливаются вручную: скачайте образ на странице ' +
  'релизов и замените программу в папке «Программы». Автоматическое ' +
  'обновление недоступно, потому что сборка не подписана сертификатом, ' +
  'который macOS принимает для проверки подлинности обновлений.';

// electron-updater импортируется лениво: он тянет за собой сеть и файловые
// операции, а нужен только по нажатию кнопки.
type UpdaterModule = typeof import('electron-updater');

let updater: import('electron-updater').AppUpdater | null = null;

// Начальное значение обязано учитывать платформу: при canInstall = false
// окно обновления покажет «автоустановка недоступна» даже на Windows,
// где она работает.
let current: UpdateStatus = {
  state: 'idle',
  canInstall: supportsAutoUpdate(),
};

let emit: (status: UpdateStatus) => void = () => {};

function setStatus(patch: Partial<UpdateStatus>): void {
  current = { ...current, ...patch };
  emit(current);
}

function baseStatus(): UpdateStatus {
  return {
    state: 'idle',
    canInstall: supportsAutoUpdate(),
  };
}

/** Загружает модуль и навешивает обработчики ровно один раз */
async function ensureUpdater(): Promise<UpdaterModule> {
  const mod = (await import('electron-updater')) as UpdaterModule;

  if (updater) return mod;

  updater = mod.autoUpdater;
  // Не мешаем закрытию: обновление ставится после выхода из программы
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;

  updater.on('checking-for-update', () => {
    setStatus({ state: 'checking', message: 'Проверяю наличие обновления…' });
  });

  updater.on('update-available', (info: { version: string }) => {
    setStatus({
      state: 'available',
      version: info.version,
      message: `Доступна версия ${info.version}`,
    });
  });

  updater.on('update-not-available', (info: { version: string }) => {
    setStatus({
      state: 'not-available',
      version: info?.version,
      message: 'Установлена последняя версия',
    });
  });

  updater.on('download-progress', (p: { percent: number; transferred: number; total: number }) => {
    setStatus({
      state: 'downloading',
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
    });
  });

  updater.on('update-downloaded', (info: { version: string }) => {
    setStatus({
      state: 'downloaded',
      version: info.version,
      percent: 100,
      message: `Версия ${info.version} загружена`,
    });
  });

  updater.on('error', (err: Error) => {
    setStatus({
      state: 'error',
      message: humanizeUpdateError(err),
      // При ошибке оставляем ручной вариант: ссылка на релиз всегда доступна
      downloadUrl: RELEASE_PAGE,
    });
  });

  return mod;
}

export function onUpdateStatus(cb: (status: UpdateStatus) => void): void {
  emit = cb;
  cb(getUpdateStatus());
}

export function getUpdateStatus(): UpdateStatus {
  return { ...current, canInstall: supportsAutoUpdate() };
}

/**
 * Переводит техническую ошибку обновления в текст для человека.
 *
 * Сырое сообщение electron-updater — это HTTP-заголовки, URL и стек-трейс
 * на пол-экрана. Пользователю от этого ничто не становится понятнее, а
 * «Cannot find latest.yml…» выглядит как поломка программы, хотя на самом
 * деле канал обновлений просто ещё не наполнен.
 */
function humanizeUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');

  // Нет файла со списком сборок — значит в последнем релизе ещё ничего
  // не опубликовано. Это не поломка, поэтому и звучит соответственно.
  if (/latest(-mac)?\.yml|Cannot find|\b404\b/i.test(raw)) {
    return (
      'В последнем релизе пока нет сборки для этой платформы. ' +
      'Новая версия появится здесь после публикации — попробуйте проверить ' +
      'обновление позже.'
    );
  }

  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|getaddrinfo|offline/i.test(raw)) {
    return 'Нет связи с сервером обновлений. Проверьте подключение к интернету.';
  }

  if (/certificate|CERT_|self.signed|unable to verify/i.test(raw)) {
    return 'Не удалось проверить подлинность соединения с сервером обновлений.';
  }

  if (!raw) return 'Не удалось проверить обновление';

  // Технические ошибки без понятного перевода оставляем короткими: длинный
  // текст в окне ничего не объясняет, а подробности можно посмотреть в логе.
  const firstLine = raw.split('\n')[0].trim();
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
}
/**
 * Оборачивает промис таймаутом.
 *
 * Без этого проверка обновлений может висеть бесконечно: нет сети, GitHub
 * недоступен, не сработал таймаут самого electron-updater. Пользователь при
 * этом видит заблокированную кнопку без единого шанса её отменить.
 */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Ручная проверка обновлений по кнопке в интерфейсе */
export async function checkForUpdates(): Promise<UpdateStatus> {
  setStatus(baseStatus());

  // На macOS проверки нет — сразу объясняем, почему, и не мучим сеть
  if (!supportsAutoUpdate()) {
    setStatus({
      state: 'not-available',
      message: MANUAL_UPDATE_HINT,
      downloadUrl: RELEASE_PAGE,
    });
    return current;
  }

  setStatus({ state: 'checking', message: 'Проверяю наличие обновления…' });

  try {
    const mod = await ensureUpdater();
    // latest.yml / latest-mac.yml берутся из последнего релиза GitHub
    await withTimeout(
      mod.autoUpdater.checkForUpdates(),
      30000,
      'Сервер обновлений не ответил вовремя'
    );
    // Промис может разрешиться, не испустив ни одного события — например,
    // когда нет файла конфигурации обновления. Тогда состояние навсегда
    // осталось бы «проверяю», а кнопка — заблокированной. Закрываем эту
    // дыру явно.
    if (current.state === 'checking') {
      setStatus({
        state: 'error',
        message:
          'Не удалось определить наличие обновления: сервер вернул ' +
          'неожиданный ответ. Проверьте обновление на странице релизов.',
        downloadUrl: RELEASE_PAGE,
      });
    }
  } catch (err) {
    setStatus({
      state: 'error',
      message: humanizeUpdateError(err),
      downloadUrl: RELEASE_PAGE,
    });
  }

  return current;
}

/**
 * Загрузка найденного обновления. Отдельно от проверки: electron-updater с
 * autoDownload = false только сообщает о наличии версии, качать надо явно.
 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!supportsAutoUpdate()) {
    setStatus({ state: 'not-available', message: MANUAL_UPDATE_HINT, downloadUrl: RELEASE_PAGE });
    return current;
  }

  try {
    const mod = await ensureUpdater();
    if (current.state !== 'available') {
      return current;
    }
    setStatus({ state: 'downloading', percent: 0, message: 'Загружаю обновление…' });
    void mod.autoUpdater.downloadUpdate();
  } catch (err) {
    setStatus({
      state: 'error',
      message: humanizeUpdateError(err),
      downloadUrl: RELEASE_PAGE,
    });
  }
  return current;
}

/**
 * Установка скачанного обновления: программа закрывается, обновляется
 * и запускается заново.
 */
export async function installUpdate(): Promise<{ success: boolean; message?: string }> {
  if (!supportsAutoUpdate()) {
    return { success: false, message: MANUAL_UPDATE_HINT };
  }

  try {
    const mod = await ensureUpdater();
    if (!mod.autoUpdater) throw new Error('Модуль обновления не загружен');

    // isSilent = false — обновление покажет окно установщика пользователю
    mod.autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: humanizeUpdateError(err),
    };
  }
}

export const RELEASE_URL = RELEASE_PAGE;