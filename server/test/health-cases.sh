#!/usr/bin/env bash
# Teste le diagnostic /api/health/db dans plusieurs scénarios de panne.
cd "$(dirname "$0")/.." || exit 1

run_case() {
  local label="$1" url="$2" port="$3"
  NODE_ENV=development DATABASE_URL="$url" \
    JWT_SECRET="dev-secret-0123456789abcdef0123456789abcdef" \
    OTP_PEPPER="dev-pepper-0123456789" \
    SMS_PROVIDER=console PORT="$port" \
    node src/index.js >/tmp/case.log 2>&1 &
  local pid=$!
  sleep 2.5
  echo "── $label"
  curl -s -m 40 "http://127.0.0.1:$port/api/health/db" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('   ok      :', d.get('ok'))
print('   erreur  :', d.get('erreur'))
for k, v in d.get('etapes', {}).items():
    print(f'   {k:18}: {v}')
if d.get('conseils'):
    print('   conseil :', d['conseils'][0])
" 2>/dev/null || echo "   (pas de réponse JSON)"
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  echo
}

run_case "A · base saine" \
  "postgresql://postgres:x@127.0.0.1:5433/vienschop?sslmode=disable" 3101

run_case "B · hôte inexistant" \
  "postgresql://neondb_owner:abc@ep-faux-123.eu-central-1.aws.neon.tech/neondb?sslmode=require" 3102

run_case "C · base inexistante" \
  "postgresql://postgres:x@127.0.0.1:5433/base_absente?sslmode=disable" 3103

run_case "D · serveur éteint" \
  "postgresql://postgres:x@127.0.0.1:5999/vienschop?sslmode=disable" 3104
