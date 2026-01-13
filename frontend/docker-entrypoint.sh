#!/bin/sh
set -e

# Runtime environment variable injection for Vite apps
# Replaces placeholder values in built JS files with actual environment variables
# This allows using pre-built images with different configs without rebuilding

JS_DIR="/usr/share/nginx/html/assets"

echo "🔧 Injecting runtime environment variables..."

# Only process if the directory exists
if [ -d "$JS_DIR" ]; then
  # Replace placeholders with actual environment values
  for file in "$JS_DIR"/*.js; do
    if [ -f "$file" ]; then
      # Replace SUPABASE_URL placeholder
      if [ -n "$VITE_SUPABASE_URL" ]; then
        sed -i "s|__SUPABASE_URL_PLACEHOLDER__|${VITE_SUPABASE_URL}|g" "$file"
        echo "  ✓ VITE_SUPABASE_URL injected"
      fi
      
      # Replace SUPABASE_PUBLISHABLE_KEY placeholder
      if [ -n "$VITE_SUPABASE_PUBLISHABLE_KEY" ]; then
        sed -i "s|__SUPABASE_PUBLISHABLE_KEY_PLACEHOLDER__|${VITE_SUPABASE_PUBLISHABLE_KEY}|g" "$file"
        echo "  ✓ VITE_SUPABASE_PUBLISHABLE_KEY injected"
      fi
    fi
  done
  echo "✅ Environment injection complete"
else
  echo "⚠️ Assets directory not found, skipping injection"
fi

# Execute the main command (nginx)
exec "$@"
