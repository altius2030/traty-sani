#!/usr/bin/env bash
#
# Создаёт самоподписанный сертификат подписи для macOS.
#
# Зачем он нужен: Squirrel.Mac при автообновлении сверяет «designated
# requirement» обновления с требованием уже установленной программы. У ad-hoc
# подписи (`codesign --sign -`) отпечаток меняется при каждой сборке, поэтому
# требования никогда не совпадут и обновление не установится. Стабильный
# сертификат — даже самоподписанный — эту задачу решает.
#
# Запускать на Mac (или там, где есть openssl). Результат:
#   TratySani.p12 — этот файл кладём в секрет GitHub MAC_CSC_P12 (base64)
#   TratySani.cer — его устанавливают на каждый Mac и доверяют один раз
#
# ВАЖНО: .p12 содержит закрытый ключ. Не кладите его в репозиторий.

set -euo pipefail

OUT_DIR="${1:-.}"
NAME="${CERT_NAME:-Traty Sani Release}"
ORG="${CERT_ORG:-Traty Sani}"
DAYS="${CERT_DAYS:-36500}"   # 100 лет: сертификат не должен истечь

command -v openssl >/dev/null || { echo "openssl не найден"; exit 1; }

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

echo "Создаю самоподписанный сертификат: CN=$NAME"
openssl req -x509 -newkey rsa:2048 -nodes -sha256 \
  -days "$DAYS" \
  -keyout TratySani.key \
  -out TratySani.cer \
  -subj "/CN=$NAME/O=$ORG"

echo "Экспортирую в .p12 (введите пароль от ключа)"
openssl pkcs12 -export \
  -out TratySani.p12 \
  -inkey TratySani.key \
  -in TratySani.cer

rm -f TratySani.key   # закрытый ключ внутри .p12, отдельно он не нужен

echo
echo "Готово:"
ls -l TratySani.p12 TratySani.cer
echo
echo "Отпечаток сертификата (он входит в designated requirement):"
openssl x509 -in TratySani.cer -noout -fingerprint -sha1
echo
echo "Дальше:"
echo "  1. Положите TratySani.p12 в секрет GitHub MAC_CSC_P12 как base64:"
echo "     base64 -i TratySani.p12 | pbcopy"
echo "     (в GitHub: Settings -> Secrets and variables -> Actions)"
echo "  2. Добавьте секрет MAC_CSC_PASSWORD с паролем от .p12"
echo "  3. На каждом Mac установите и доверите сертификат:"
echo "     sudo security add-trusted-cert -d -r trustRoot \\"
echo "       -k /Library/Keychains/System.keychain TratySani.cer"
echo "  4. Пересоберите приложение и опубликуйте под тегом — только с этого"
echo "     момента автообновление на macOS заработает. Установленные ранее"
echo "     ad-hoc сборки обновятся один раз вручную."