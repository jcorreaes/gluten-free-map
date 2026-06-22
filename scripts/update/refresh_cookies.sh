#!/usr/bin/env bash
# Extrae las cookies de Google de Chrome (macOS) y las guarda en cookies.json.
# Uso:
#   ./refresh_cookies.sh                            # guarda localmente
#   ./refresh_cookies.sh --send-to user@host        # guarda + copia por SCP

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="$SCRIPT_DIR/cookies.json"
SEND_TO=""

# Parsear args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --send-to) SEND_TO="$2"; shift 2 ;;
    *) echo "Uso: $0 [--send-to user@host]" >&2; exit 1 ;;
  esac
done

# Verificar que Chrome esté abierto
if ! pgrep -x "Google Chrome" > /dev/null 2>&1; then
  echo "✗ Google Chrome no está abierto. Ábrelo, inicia sesión en Google y vuelve a ejecutar." >&2
  exit 1
fi

echo "→ Extrayendo cookies de Google desde Chrome…"

# AppleScript para ejecutar JS en la pestaña activa de Chrome
COOKIES_JSON=$(osascript <<'APPLESCRIPT'
tell application "Google Chrome"
  set cookieScript to "
    (function() {
      const names = [
        'SID','HSID','SSID','APISID','SAPISID',
        '__Secure-1PAPISID','__Secure-3PAPISID',
        'SIDCC','SOCS','NID','1P_JAR',
        '__Secure-1PSID','__Secure-3PSID'
      ];
      const result = {};
      function parseCookies(cookieStr) {
        cookieStr.split(';').forEach(c => {
          const i = c.indexOf('=');
          if (i < 0) return;
          const k = c.slice(0, i).trim();
          if (names.includes(k)) result[k] = c.slice(i + 1).trim();
        });
      }
      parseCookies(document.cookie);
      return JSON.stringify(result);
    })()
  "
  set tabFound to false
  repeat with w in windows
    repeat with t in tabs of w
      if URL of t contains \"google.com\" then
        set tabFound to true
        set result to execute t javascript cookieScript
        return result
      end if
    end repeat
  end repeat
  if not tabFound then
    return "{}"
  end if
end tell
APPLESCRIPT
)

# Verificar que se obtuvieron cookies
if [[ -z "$COOKIES_JSON" || "$COOKIES_JSON" == "{}" ]]; then
  echo ""
  echo "⚠ No se encontraron cookies de Google. Asegúrate de:" >&2
  echo "  1. Tener una pestaña de google.com abierta en Chrome" >&2
  echo "  2. Haber iniciado sesión en tu cuenta Google" >&2
  echo "  3. Tener habilitado: Chrome > Ver > Desarrollador > Permitir JavaScript de Apple Events" >&2
  exit 1
fi

# Contar cookies extraídas
COUNT=$(echo "$COOKIES_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d))")

if [[ "$COUNT" -eq 0 ]]; then
  echo "⚠ Se obtuvo una respuesta vacía. Comprueba que la sesión de Google está activa." >&2
  exit 1
fi

# Guardar
echo "$COOKIES_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d, indent=2))" > "$OUTPUT"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
echo "✓ $COUNT cookies guardadas en $OUTPUT  [$TIMESTAMP]"

# Listar claves (sin valores)
echo "  Claves: $(echo "$COOKIES_JSON" | python3 -c "import json,sys; print(', '.join(json.load(sys.stdin).keys()))")"

# Enviar por SCP si se indicó
if [[ -n "$SEND_TO" ]]; then
  HOST="${SEND_TO%%:*}"
  if [[ "$SEND_TO" == *":"* ]]; then
    REMOTE_PATH="${SEND_TO#*:}"
  else
    REMOTE_PATH="~/Projects/gluten-free-map/scripts/update/cookies.json"
  fi

  echo "→ Copiando a $HOST:$REMOTE_PATH…"
  if scp "$OUTPUT" "$SEND_TO:$REMOTE_PATH" 2>/dev/null || scp "$OUTPUT" "${HOST}:${REMOTE_PATH}"; then
    echo "✓ Cookies enviadas a $SEND_TO"
  else
    echo "✗ Error al copiar. Comprueba la conexión SSH a $HOST." >&2
    exit 1
  fi
fi
