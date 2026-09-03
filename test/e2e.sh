#!/usr/bin/env bash
# End-to-end harness: the real container behind a real proxy, deployed to by
# the real CLI. Everything binds to localhost and is removed on exit.
set -euo pipefail
cd "$(dirname "$0")"

HOST=http://127.0.0.1:18199
export MOONBUNNY_HOST=$HOST MOONBUNNY_TOKEN=test-token

compose() { docker compose -f compose.yml "$@"; }
cli() { node ../cli/moonbunny.mjs deploy "$@"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

trap 'compose down --volumes --timeout 2 > /dev/null 2>&1' EXIT
compose up -d --build --quiet-pull

# The proxy answers 502 until the app is up, so readiness is the app's own
# 404 for the root path.
ready() {
  for _ in $(seq 1 40); do
    [[ "$(code "$HOST/")" == 404 ]] && return
    sleep 0.5
  done
  echo "stack never became ready" >&2
  exit 1
}
ready

fails=0
check() {
  if [[ $2 == "$3" ]]; then
    echo "ok: $1"
  else
    echo "FAIL: $1 (expected: $2, got: $3)"
    fails=$((fails + 1))
  fi
}

url=$(cli fixtures --project reports --slug smoke --auth me:secret)
check "deploy prints the url" "$HOST/reports/smoke/" "$url"
check "protected page needs auth" 401 "$(code "$HOST/reports/smoke/")"
check "protected page serves with auth" 200 "$(code -u me:secret "$HOST/reports/smoke/")"
check "html arrives intact" '<h1>smoke</h1>' "$(curl -s -u me:secret "$HOST/reports/smoke/" | grep -o '<h1>smoke</h1>')"
check "asset mime type" text/css "$(curl -s -o /dev/null -w '%{content_type}' -u me:secret "$HOST/reports/smoke/style.css")"
check "metadata file is hidden" 404 "$(code -u me:secret "$HOST/reports/smoke/.meta.json")"
check "directory redirects to slash" 301 "$(code -u me:secret "$HOST/reports/smoke")"
check "traversal is blocked" 404 "$(code -u me:secret "$HOST/reports/smoke/..%2f..%2fetc%2fpasswd")"

url2=$(cli fixtures --project reports)
check "uuid deploy serves without auth" 200 "$(code "$url2")"

if MOONBUNNY_TOKEN=bad cli fixtures --project reports --slug intruder > /dev/null 2>&1; then
  check "bad token is rejected" rejected accepted
else
  check "bad token is rejected" rejected rejected
fi

# Flags beat env vars: bad env, correct flags.
urlflag=$(MOONBUNNY_HOST=http://127.0.0.1:1 MOONBUNNY_TOKEN=bad cli fixtures --project reports --host "$HOST" --token test-token)
check "host and token flags override env" 200 "$(code "$urlflag")"

url3=$(cli fixtures --project reports --slug smoke)
case $url3 in
  "$HOST/reports/smoke-"*) check "taken slug gets a unique suffix" suffixed suffixed ;;
  *) check "taken slug gets a unique suffix" "$HOST/reports/smoke-*" "$url3" ;;
esac
check "suffixed deploy serves" 200 "$(code "$url3")"
check "original deploy is untouched" 401 "$(code "$HOST/reports/smoke/")"

url4=$(cli fixtures --project "My Reports" --slug "Fancy Report")
check "project and slug are slugified" "$HOST/my-reports/fancy-report/" "$url4"

urlfile=$(cli fixtures/index.html --project reports --slug single)
check "single file deploys as the index" 200 "$(code "$urlfile")"

check "nosniff header is set" nosniff "$(curl -sI -u me:secret "$HOST/reports/smoke/" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-content-type-options"{print $2}')"

# A relative dot-dot symlink survives tar but must not survive the deploy.
evil=$(mktemp -d)
echo '<h1>evil</h1>' > "$evil/index.html"
ln -s ../../../../etc/passwd "$evil/escape"
urlevil=$(cli "$evil" --project reports --slug escape-attempt)
rm -rf "$evil"
check "symlink is scrubbed from the deploy" 404 "$(code "$urlevil"escape)"
check "scrubbed deploy still serves" 200 "$(code "$urlevil")"

check "robots.txt is forced" "User-agent: *" "$(curl -s "$HOST/robots.txt" | head -1)"

fake=$(mktemp -d)
echo '<h1>fake</h1>' > "$fake/index.html"
echo '{"auth":"attacker:pwn"}' > "$fake/.meta.json"
urlfake=$(cli "$fake" --project reports --slug fake-meta)
rm -rf "$fake"
check "server metadata beats a deployed one" 200 "$(code "$urlfake")"

# The compressed body is capped at 50MB.
big=$(mktemp)
dd if=/dev/urandom bs=1048576 count=51 of="$big" 2> /dev/null
check "oversized upload is rejected" 413 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Authorization: Bearer test-token' --data-binary "@$big" "$HOST/_deploy/reports/too-big")"
rm -f "$big"

# Expiration: the sweep runs at server start, so an expired deploy vanishes
# across a restart while a non-expiring one survives it.
url5=$(cli fixtures --project reports --slug fleeting --expires 0.00002)
url6=$(cli fixtures --project reports --slug forever --expires 0)
sleep 3
compose restart > /dev/null 2>&1
ready
check "expired deploy is swept at start" 404 "$(code "$url5")"
check "non-expiring deploy survives the sweep" 200 "$(code "$url6")"

echo
if [[ $fails -eq 0 ]]; then
  echo "all checks passed"
else
  echo "$fails check(s) failed"
  exit 1
fi
