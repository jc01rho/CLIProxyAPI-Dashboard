#!/bin/sh
set -eu

CONFIG_FILE="/usr/share/nginx/html/app-config.js"

write_config() {
  cat > "$CONFIG_FILE" <<EOF
window.__APP_CONFIG__ = {
  DATABASE_PROVIDER: "${DATABASE_PROVIDER:-${VITE_DATABASE_PROVIDER:-local}}",
  VITE_DATABASE_PROVIDER: "${VITE_DATABASE_PROVIDER:-${DATABASE_PROVIDER:-local}}",
  SUPABASE_URL: "${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}",
  VITE_SUPABASE_URL: "${VITE_SUPABASE_URL:-${SUPABASE_URL:-}}",
  SUPABASE_PUBLISHABLE_KEY: "${SUPABASE_PUBLISHABLE_KEY:-${VITE_SUPABASE_PUBLISHABLE_KEY:-}}",
  VITE_SUPABASE_PUBLISHABLE_KEY: "${VITE_SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_PUBLISHABLE_KEY:-}}"
};
EOF
}

write_config

NGINX_CONF="/etc/nginx/conf.d/default.conf"
PROVIDER="${DATABASE_PROVIDER:-${VITE_DATABASE_PROVIDER:-local}}"

if [ "$PROVIDER" = "supabase" ]; then
  sed -i '/upstream postgrest_backend/,/}/c\upstream postgrest_backend {\n    server 127.0.0.1:1;\n}' "$NGINX_CONF"
  sed -i 's|proxy_pass http://postgrest_backend/;|return 404;|' "$NGINX_CONF"
fi
