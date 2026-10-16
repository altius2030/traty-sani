const fs = require('fs');
const path = require('path');

/**
 * electron-builder hook afterPack.
 *
 * Кладёт в бандл файл `stable-signature.txt`, когда сборка подписана
 * настоящим идентификатором (в том числе самоподписанным). Приложение
 * читает этот файл и понимает, разрешена ли автоустановка на macOS:
 * Squirrel.Mac сверяет designated requirement обновления с требованием
 * запущенной программы, а у ad-hoc подписи отпечаток меняется при каждой
 * сборке, поэтому такие сборки обновляются только вручную.
 *
 * Хук важен именно здесь: zip для Squirrel.Mac собирается из бандла сразу
 * после упаковки, и отметка, записанная позже, в архив уже не попала бы.
 */
exports.default = async function afterPack(context) {
  const identity = process.env.MACOS_SIGN_IDENTITY;
  if (!identity) {
    console.log('[afterPack] идентификатор не задан — отметка об устойчивой подписи не нужна');
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const resources = path.join(context.appOutDir, appName, 'Contents', 'Resources');
  if (!fs.existsSync(resources)) {
    console.warn(`[afterPack] нет каталога ${resources} — отметка не записана`);
    return;
  }

  fs.writeFileSync(path.join(resources, 'stable-signature.txt'), identity, 'utf-8');
  console.log(`[afterPack] отметка об устойчивой подписи записана: ${identity}`);
};