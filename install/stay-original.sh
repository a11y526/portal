#!/usr/bin/env bash
# 복사한 저장소(Fork)의 사이트 파일을 매일 원래 포털(a11y526/science-portal)과 똑같이 맞춘다(2026-11-12 사용자 결정:
# 다른 선생님은 관리 화면으로만 바꾸고, 파일을 직접 고친 것은 다음 날 원래대로 돌아간다).
# 남기는 것: assets/js/site.js(내 서버 주소·담당 반), .github/(이 일 자체. GitHub이 일 파일 바꾸기를 막아서),
#            원래 포털에 없는 lessons/·sims/ 파일(선생님이 따로 올린 수업자료),
#            선생님 몫 파일: CLAUDE.md, .gitignore, supabase/90_my.sql, 작업규칙/(꾸러미로 받은 작업 규칙. 2026-11-13 사용자 결정)
# 그 밖에는 원래 포털에 있는 파일은 원래 내용으로, 원래 포털에 없는 파일은 지운다.
# sync-upstream.yml이 원래 포털에서 이 파일을 받아 실행한다(이 저장소의 사본이 고쳐져 있어도 원래 것을 씀).
set -euo pipefail
UP="${UP:-https://github.com/a11y526/science-portal.git}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git config core.quotePath false   # 한글 파일 이름을 "\355..."로 바꾸지 않고 그대로 (아래 case가 맞도록)
git fetch --no-tags --quiet "$UP" main
up=$(git rev-parse FETCH_HEAD)

# 따로 쓰는 임시 색인에서 새 내용(트리)을 만든다
GIT_INDEX_FILE="$(mktemp -u)"; export GIT_INDEX_FILE
git read-tree "$up"
git ls-files -z -- .github assets/js/site.js CLAUDE.md .gitignore supabase/90_my.sql 작업규칙 | git update-index -z --force-remove --stdin
keep=$(git ls-tree -r --name-only HEAD | while IFS= read -r f; do
  case "$f" in
    (.github/*|assets/js/site.js|CLAUDE.md|.gitignore|supabase/90_my.sql|작업규칙/*) echo "$f" ;;
    (lessons/*|sims/*) git cat-file -e "$up:$f" 2>/dev/null || echo "$f" ;;
  esac
done)
if [ -n "$keep" ]; then
  printf '%s\n' "$keep" | while IFS= read -r f; do git ls-tree HEAD -- "$f"; done | git update-index --index-info
fi
tree=$(git write-tree)
rm -f "$GIT_INDEX_FILE"; unset GIT_INDEX_FILE

if [ "$tree" = "$(git rev-parse 'HEAD^{tree}')" ]; then
  echo "원래 포털과 같음"
  exit 0
fi
git diff --stat HEAD "$tree" | tail -20
c=$(git commit-tree "$tree" -p HEAD -m "원래 포털과 맞춤 (${up:0:7})")
git push --quiet origin "$c:refs/heads/main"
echo "맞춤: $c"
# 이 일이 올린 변경은 사이트 다시 만들기를 깨우지 않으므로 직접 부탁한다
gh api -X POST "repos/$GITHUB_REPOSITORY/pages/builds" >/dev/null || echo "사이트 다시 만들기 요청 실패(다음 변경 때 다시)"
