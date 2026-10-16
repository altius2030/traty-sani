import { autoUpdater } from 'electron-updater';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Обновление приложения.
 *
 * Логика живёт в главном процессе, а интерфейс только показывает состояние:
 * так обновление продолжает качаться, даже если окно перерисовалось.
 *
 * Канал обновлений — GitHub Releases: electron-updater читает из корня
 * релиза latest.yml (Windows) и latest-mac.yml (macOS), а сами файлы
 * сборки лежат рядом с ними.
 *
 * Про подпись на macOS: Squirrel.Mac сверяет «designated requirement»
 * обновления с требованием запущенной программы, а не сертификат Apple.
 * Поэтому стабильный самоподписанный сертификат подходит — при условии,
 * что им подписан каждая сборка. Ad-hoc подпись (`codesign --sign -`)
 * для этого не годится: её отпечаток меняется при каждой сборке, и
 * требования никогда не совпадут.
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
 * Есть ли у сборки устойчивая подпись.
 *
 * CI кладёт в бандл файл `stable-signature.txt` с именем сертификата, когда
 * подписывает приложение настоящим (в том числе самоподписанным)
 * идентификатором. При ad-hoc подписи файла нет — и автоустановка на macOS
 * невозможна: отпечаток ad-hoc меняется при каждой сборке, поэтому
 * designated requirement обновления никогда не совпадёт с требованием
 * запущенной программы.
 *
 * Windows подписей не требует, там ответ всегда «да».
 */
export function hasStableSignature(): boolean {
  if (process.platform !== 'darwin') return true;
  try {
    const marker = join(process.resourcesPath, 'stable-signature.txt');
    return existsSync(marker) && readFileSync(marker, 'utf-8').trim().length > 0;
  } catch {
    return false;
  }
}

// electron-updater импортируется лениво: он тянет за собой сеть и файловые
// операции, а нужен только по нажатию кнопки.
type UpdaterModule = typeof import('electron-updater');

let updater: import('electron-updater').AppUpdater | null = null;

// Начальное значение обязано учитывать платформу: при canInstall = false
// окно обновления покажет «автоустановка недоступна» даже на Windows,
// где она работает. hasStableSignature() читает файл при каждом вызове,
// поэтому состояние пересобирается перед отдачей наружу.
let current: UpdateStatus = {
  state: 'idle',
  canInstall: process.platform !== 'darwin',
};

let emit: (status: UpdateStatus) => void = () => {};

function setStatus(patch: Partial<UpdateStatus>): void {
  current = { ...current, ...patch };
  emit(current);
}

function baseStatus(): UpdateStatus {
  return {
    state: 'idle',
    canInstall: hasStableSignature(),
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
      message: err?.message || 'Не удалось проверить обновление',
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
  // Подпись не меняется за время работы программы, но проверить её здесь
  // дёшево и это снимает зависимость от того, как было собрано состояние
  return { ...current, canInstall: hasStableSignature() };
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
      message:
        err instanceof Error
          ? `Не удалось проверить обновление: ${err.message}`
          : 'Не удалось проверить обновление',
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
      message:
        err instanceof Error
          ? `Не удалось загрузить обновление: ${err.message}`
          : 'Не удалось загрузить обновление',
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
  try {
    const mod = await ensureUpdater();
    if (!mod.autoUpdater) throw new Error('Модуль обновления не загружен');

    // На macOS автоустановка требует устойчивой подписи; без неё Squirrel.Mac
    // откажется обновлять. Лучше честно сказать об этом, чем зависнуть.
    if (!hasStableSignature()) {
      return {
        success: false,
        message:
          'Автоустановка на macOS требует устойчивой подписи приложения. ' +
          'Скачайте обновление вручную и замените программу в «Программах».',
      };
    }

    // isSilent = false — обновление покажет окно установщика пользователю
    mod.autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Не удалось установить обновление',
    };
  }
}

export const RELEASE_URL = RELEASE_PAGE;