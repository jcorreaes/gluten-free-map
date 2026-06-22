#!/usr/bin/env bash
# Wrapper para ejecutar update.py desde cron en mininuc.
# - Usa el venv local (.venv/)
# - Si hay cookies.json actualiza todas las fuentes; si no, omite las privadas
# - Hace git commit si los datos cambiaron
# - Guarda log rotado en logs/update.log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/update.log"
PYTHON="$SCRIPT_DIR/.venv/bin/python"
MAX_LOG_LINES=2000

mkdir -p "$LOG_DIR"

stamp() { date +"%Y-%m-%d %H:%M:%S"; }

{
  echo ""
  echo "════════════════════════════════════════"
  echo "  $(stamp)  –  Actualización iniciada"
  echo "════════════════════════════════════════"

  if [ ! -f "$PYTHON" ]; then
    echo "✗ venv no encontrado en $SCRIPT_DIR/.venv"
    echo "  Ejecuta: cd $SCRIPT_DIR && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/playwright install chromium"
    exit 1
  fi

  cd "$PROJECT_ROOT"

  # Decidir flags según disponibilidad de cookies
  FLAGS=""
  if [ ! -f "$SCRIPT_DIR/cookies.json" ]; then
    echo "⚠ cookies.json no encontrado → omitiendo listas privadas de Google Maps"
    FLAGS="--skip-savedlists"
  fi

  "$PYTHON" "$SCRIPT_DIR/update.py" $FLAGS

  # Git commit si hay cambios en los datos
  if git diff --quiet public/data/; then
    echo "ℹ Sin cambios en los datos, nada que commitear"
  else
    CHANGED=$(git diff --name-only public/data/ | tr '\n' ' ')
    git add public/data/
    git commit -m "data: actualización automática $(date +%Y-%m-%d)

Archivos actualizados: $CHANGED"
    echo "✓ Commit creado"

    # Descomentar cuando haya remote configurado:
    # git push
  fi

  echo ""
  echo "  $(stamp)  –  Actualización completada"

} >> "$LOG_FILE" 2>&1

# Rotar log (mantener las últimas MAX_LOG_LINES líneas)
if [ "$(wc -l < "$LOG_FILE")" -gt "$MAX_LOG_LINES" ]; then
  tail -n "$MAX_LOG_LINES" "$LOG_FILE" > "$LOG_FILE.tmp"
  mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
