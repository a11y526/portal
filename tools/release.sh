#!/bin/zsh
# 배포: 버전을 하나 올리고(2.1.1 → 2.1.2) 커밋 · 태그 · push · GitHub 릴리스
# 쓰는 법: 바꾼 파일을 git add 해 둔 뒤
#   tools/release.sh "무엇을 바꿨는지 한 줄"
# (VERSION만 올리고 싶으면 아무것도 add 하지 않고 실행해도 됨)
set -e
cd "$(dirname "$0")/.."

msg="$1"
if [[ -z "$msg" ]]; then echo '사용: tools/release.sh "바꾼 내용"'; exit 1; fi

old=$(tr -d ' \n' < VERSION)
IFS=. read -r ma mi pa <<< "$old"
new="$ma.$mi.$((pa + 1))"

echo "$new" > VERSION
git add VERSION
git commit -q -m "v$new: $msg" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag -a "v$new" -m "$msg"
git push -q origin main
git push -q origin "v$new"
if command -v gh >/dev/null; then
  gh release create "v$new" --title "v$new" --notes "$msg" >/dev/null || echo "(릴리스 페이지는 못 만듦, 태그는 올라감)"
fi
echo "v$old → v$new 배포함"
