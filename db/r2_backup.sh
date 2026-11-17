#!/usr/bin/env bash
# Ship one already-encrypted backup file to Cloudflare R2, verify it, and prune old copies.
#
#   usage:  db/r2_backup.sh t212-data-YYYYMMDD-HHMM.sql.gz.gpg
#   env:    R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET
#
# Layout in the bucket (grandfather-father-son):
#   daily/    every run                        kept DAILY_KEEP_DAYS   (default   7)
#   weekly/   copy made on Sundays (UTC)       kept WEEKLY_KEEP_DAYS  (default  35)
#   monthly/  copy made on the 1st (UTC)       kept MONTHLY_KEEP_DAYS (default 400)
#
# Only files named t212-data-*.sql.gz.gpg are ever deleted, and only by age.
set -euo pipefail

f="${1:?usage: r2_backup.sh FILE}"
: "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${R2_BUCKET:?}"
DAILY_KEEP_DAYS="${DAILY_KEEP_DAYS:-7}"
WEEKLY_KEEP_DAYS="${WEEKLY_KEEP_DAYS:-35}"
MONTHLY_KEEP_DAYS="${MONTHLY_KEEP_DAYS:-400}"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto AWS_EC2_METADATA_DISABLED=true
# R2 doesn't need the newer default CRC checksums; avoids client/server mismatches.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
s3()  { aws s3 --endpoint-url "$endpoint" "$@"; }
api() { aws s3api --endpoint-url "$endpoint" "$@"; }

name="$(basename "$f")"
want="$(stat -c %s "$f")"

# ── upload + verify (size round-trip) ───────────────────────────────────────────
s3 cp "$f" "s3://$R2_BUCKET/daily/$name" --only-show-errors
got="$(api head-object --bucket "$R2_BUCKET" --key "daily/$name" --query ContentLength --output text)"
if [ "$got" != "$want" ]; then
  echo "::error::R2 object size ($got) != local file size ($want) — upload is not trustworthy"
  exit 1
fi
echo "Uploaded daily/$name ($want bytes) and verified size."

# ── promote to weekly / monthly tiers ───────────────────────────────────────────
if [ "$(date -u +%u)" = 7 ]; then
  s3 cp "s3://$R2_BUCKET/daily/$name" "s3://$R2_BUCKET/weekly/$name" --only-show-errors
  echo "Promoted to weekly/"
fi
if [ "$(date -u +%d)" = 01 ]; then
  s3 cp "s3://$R2_BUCKET/daily/$name" "s3://$R2_BUCKET/monthly/$name" --only-show-errors
  echo "Promoted to monthly/"
fi

# ── prune by age ────────────────────────────────────────────────────────────────
prune() {  # prefix keep_days
  local prefix="$1" days="$2" cutoff key lm
  cutoff="$(date -u -d "-${days} days" +%Y-%m-%dT%H:%M:%S)"
  api list-objects-v2 --bucket "$R2_BUCKET" --prefix "$prefix/" \
      --query 'Contents[].[Key,LastModified]' --output text |
  while read -r key lm; do
    [ "$key" = "None" ] && continue
    case "$(basename "$key")" in t212-data-*.sql.gz.gpg) ;; *) continue ;; esac
    if [[ "${lm:0:19}" < "$cutoff" ]]; then
      echo "Pruning $key (modified $lm, older than ${days}d)"
      api delete-object --bucket "$R2_BUCKET" --key "$key"
    fi
  done
}
prune daily   "$DAILY_KEEP_DAYS"
prune weekly  "$WEEKLY_KEEP_DAYS"
prune monthly "$MONTHLY_KEEP_DAYS"

echo "Bucket now holds:"
for p in daily weekly monthly; do
  printf '  %-8s %s object(s)\n' "$p/" "$(api list-objects-v2 --bucket "$R2_BUCKET" --prefix "$p/" --query 'length(Contents || `[]`)' --output text)"
done
