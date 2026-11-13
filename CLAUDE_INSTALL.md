# 과학 수업 포털 — Claude 자동 설치 안내

이 파일은 **다른 선생님 컴퓨터의 Claude**가 읽고 그대로 따라 하는 설치 순서다.
원래 포털(`a11y526/portal`)을 선생님 계정으로 복사하고, 선생님의 새 Supabase 서버에 설치해서, 선생님 반 전용 사이트를 만든다.
원래 사이트와 학생·점수·순위가 섞이지 않는다(서버가 따로).
설치가 끝나면 원래 포털의 새 기능이 매일 새벽 저절로 들어온다(서버는 `06_auto_update.sql`, 사이트는 GitHub Actions `새 기능 받기`).

> Claude 없이 설치하려면: 윈도우에서 `install/설치.bat`을 내려받아 두 번 누르면 이 순서를 모두 자동으로 한다.

## Claude가 지킬 것

- 선생님은 개발자가 아니다. 선생님이 해야 하는 일은 **번호를 매긴 쉬운 한국어**로, 화면에서 찾는 방법까지 안내한다.
- 사이트 파일(`assets/js/site.js`)에는 Project URL과 **publishable(또는 anon) 키만** 넣는다. `secret`·`service_role` 키는 어디에도 쓰지 않는다.
- 선생님 체험 코드(0번 코드)는 SQL로 해시만 저장하고, 파일·커밋·메모 어디에도 적지 않는다.
- 학생 실명·연락처 같은 개인정보는 다루지 않는다.
- 아래 순서의 SQL 말고 다른 표·함수를 만들거나 지우지 않는다.

## 준비물 (선생님이 미리 함)

1. GitHub 가입
2. Supabase 가입(supabase.com)
3. Claude에 **GitHub**와 **Supabase** 연결(커넥터). Supabase 연결이 없으면 이 순서를 진행할 수 없으니 먼저 연결하게 안내한다

## 0. 선생님께 물어볼 것 (한 번에)

- 담당 반 번호 (예: 1, 2, 3, 4, 5, 6)
- 선생님 체험 코드: 숫자 6자리. 반마다 0번 계정이 선생님 체험용이고 이 코드로 로그인한다(순위에는 안 나옴). 따로 적어 두라고 말한다
- 학년은 1학년으로 고정이다(화면 글자가 '1학년'). 다른 학년이면 여기서 멈추고 원래 사이트 선생님께 알리게 한다

## 1. GitHub: 저장소 복사 + 사이트 켜기

1. `a11y526/portal`을 선생님 계정으로 **Fork**한다(이름은 그대로 `portal`). 도구가 없으면 선생님께: github.com/a11y526/portal → 오른쪽 위 **Fork** → **Create fork**
2. **Pages 켜기**: 브랜치 `main`, 폴더 `/`(root). `gh`가 있으면
   `gh api -X POST repos/<계정>/portal/pages -f "source[branch]=main" -f "source[path]=/"`
   없으면 선생님께: 내 저장소 → **Settings** → 왼쪽 **Pages** → Branch를 **main**, 폴더 **/(root)** → **Save**
3. 사이트 주소는 `https://<계정>.github.io/portal/` (켠 뒤 몇 분 걸림)

## 2. Supabase: 새 프로젝트

1. 조직(organization)을 확인하고, 비용을 확인한다(무료 플랜이면 0원. 선생님께 금액을 말하고 확인받는다)
2. 새 프로젝트: 이름 `science-portal`, 지역 **ap-northeast-2 (Seoul)**
3. 상태가 `ACTIVE_HEALTHY`가 될 때까지 기다린다(몇 분)
4. Project URL과 **publishable 키**(없으면 legacy `anon` 키)를 받아 둔다

## 3. 서버에 설치 (SQL 4개)

설치 파일은 아주 길어서(03은 약 40만 자) 옮겨 적지 않는다. **데이터베이스가 GitHub에서 직접 받아 실행**하게 한다. 아래 SQL은 Supabase의 SQL 실행 도구(`execute_sql`)로 한 단계씩 실행한다. `<REF>`는 새 프로젝트 주소의 영문 20자, `<계정>`은 GitHub 계정 이름이다.

**3-1. 받아 오기 준비**

```sql
create extension if not exists pg_net;
select
  net.http_get('https://raw.githubusercontent.com/<계정>/portal/main/supabase/01_schema.sql', timeout_milliseconds := 30000) as f1,
  net.http_get('https://raw.githubusercontent.com/<계정>/portal/main/supabase/02_policies.sql', timeout_milliseconds := 30000) as f2,
  net.http_get('https://raw.githubusercontent.com/<계정>/portal/main/supabase/03_functions.sql', timeout_milliseconds := 30000) as f3,
  net.http_get('https://raw.githubusercontent.com/<계정>/portal/main/supabase/04_seed.sql', timeout_milliseconds := 30000) as f4;
```

나온 번호 4개(f1~f4)를 적어 둔다. 몇 초 뒤 받아졌는지 확인한다. 4개 모두 `status_code`가 200이고 `len`이 0보다 커야 한다(포크가 아직 안 만들어졌으면 404 → 잠시 뒤 3-1을 다시).

```sql
select id, status_code, length(content) as len, left(content, 40) as head
from net._http_response where id in (<f1>, <f2>, <f3>, <f4>) order by id;
```

**3-2. 차례로 실행** — 01 → 02 → 03 → 04 순서. 앞 단계가 성공해야 다음으로 간다. `<ID>`에 그 파일 번호를 넣는다.

01·02·03은 이것으로(파일마다 한 번씩):

```sql
do $run$
declare s text;
begin
  select content into s from net._http_response where id = <ID>;
  s := replace(s, 'https://sxejmhkevefwnpwldczt.supabase.co', 'https://<REF>.supabase.co');
  execute s;
end
$run$;
```

04는 반 번호도 바꾼다(`[1, 2, 3, 4, 5, 6]`을 0번에서 받은 담당 반으로):

```sql
do $run$
declare s text;
begin
  select content into s from net._http_response where id = <ID>;
  if (select count(*) from regexp_matches(s, 'unnest\(array\[[0-9, ]+\]\)', 'g')) <> 1 then
    raise exception '04_seed.sql에서 반 목록 줄을 찾지 못함';
  end if;
  s := replace(s, 'https://sxejmhkevefwnpwldczt.supabase.co', 'https://<REF>.supabase.co');
  s := regexp_replace(s, 'unnest\(array\[[0-9, ]+\]\)', 'unnest(array[1, 2, 3, 4, 5, 6])');
  execute s;
end
$run$;
```

**3-3. 선생님 체험 코드** (`<코드>`에 0번에서 받은 숫자 6자리. 이 SQL은 파일로 남기지 않는다)

```sql
update public.students set code_hash = extensions.crypt('<코드>', extensions.gen_salt('bf'))
where number = 0 or class_id = 20;
```

**3-3b. 자동 업데이트** — `06_auto_update.sql`을 3-1처럼 받아(`net.http_get(…/supabase/06_auto_update.sql…)`) 3-2의 01·02·03 방식으로 실행한 뒤, 설정을 넣는다(`<계정>`·`<REF>`·담당 반을 채움):

```sql
insert into public.settings (key, value) values ('auto_update', jsonb_build_object(
  'on', true,
  'source', 'https://raw.githubusercontent.com/a11y526/portal/main/supabase/',
  'url', 'https://<REF>.supabase.co',
  'classes', '[1, 2, 3, 4, 5, 6]'::jsonb))
on conflict (key) do update set value = public.settings.value || excluded.value;
```

매일 한국 시간 2:00에 원래 저장소의 01~04를 받고 2:05에 달라졌으면 다시 실행한다(오류가 나면 모두 되돌리고 `settings.auto_update.error`에 적음).
수업자료·시뮬레이션·웹 학습지는 공유 자료실(https://a11y526.github.io/science-share/)에서 [내 포털에 넣기]로 가져온다.

**3-4. 확인** — `installed`, `seeded`가 true이고 `classes`가 담당 반과 같아야 한다.

```sql
select public.setup_status();
```

실패하면 오류 글을 그대로 선생님께 보여 주고, 원래 사이트 선생님께 전달하게 한다. 01~04는 다시 실행해도 안전하므로, 고친 뒤 실패한 파일부터 다시 실행하면 된다.

## 4. 사이트를 새 서버로 바꾸기

선생님 저장소의 `assets/js/site.js`를 **이 내용 그대로** 바꾸고 커밋한다(커밋 메시지: `내 서버로 연결`). GitHub 도구가 없으면 선생님께 파일 내용을 주고: 내 저장소 → `assets` → `js` → `site.js` → 연필(Edit) → 전부 지우고 붙여 넣기 → **Commit changes**

```js
// 이 사이트만의 값. 설치 도우미(setup.html)가 만든 파일로 통째로 바꾼다.
// Project URL과 공개(publishable) 키만 넣는다. service_role(secret) 키는 절대 넣지 않는다.
export const SUPABASE_URL = 'https://<REF>.supabase.co';
export const SUPABASE_ANON_KEY = '<publishable 키>';
export const CLASSES = [1, 2, 3, 4, 5, 6];
```

`site.js` 말고 다른 파일은 고치지 않는다(그래야 나중에 원래 사이트의 새 기능을 그대로 받을 수 있다).

사이트 자동 업데이트 켜기: 내 저장소의 Actions를 켜고 `새 기능 받기`(`sync-upstream.yml`)를 켠다. `gh`가 있으면
`gh api -X PUT repos/<계정>/portal/actions/permissions -F enabled=true -f allowed_actions=all` 와 `gh workflow enable sync-upstream.yml -R <계정>/portal`.
없으면 선생님께: 내 저장소 → **Actions** 탭 → 초록 단추(**I understand my workflows, go ahead and enable them**) → 왼쪽 **새 기능 받기** → **Enable workflow**

## 5. 교사 계정

1. 선생님께: Supabase 프로젝트 → 왼쪽 **Authentication** → **Users** → **Add user** → **Create new user** → 이메일·비밀번호 입력, **Auto Confirm User** 켜기 → **Create user**. (비밀번호는 Claude가 묻거나 받지 않는다)
2. 선생님이 알려 준 이메일로 교사 등록:

```sql
insert into public.teachers (user_id)
select id from auth.users where lower(email) = lower('<이메일>')
on conflict do nothing;
select count(*) as teachers from public.teachers;
```

`teachers`가 1이면 된다.

## 6. 확인과 안내

1. 몇 분 뒤 `https://<계정>.github.io/portal/assets/js/site.js`를 열어 새 주소가 들어 있는지 확인한다(예전 주소면 GitHub Pages가 아직 바뀌는 중. 몇 분 뒤 다시)
2. 선생님께 알려 줄 것:
   - 학생 입구: `https://<계정>.github.io/portal/`
   - 관리 화면: `https://<계정>.github.io/portal/teacher/` (5번의 이메일·비밀번호로 로그인)
   - 관리 화면 → **명단과 코드**: 반마다 마지막 번호를 넣고 학생 코드 발급·인쇄
   - 관리 화면 → **수업 시작**: 차시를 추가하고 수업자료 주소(`lessons/611.html` 등)와 학습지를 올림
   - 선생님 체험 계정: 각 반 번호 **0** + 체험 코드

## 나중에: 새 기능 받기

평소에는 저절로 된다(매일 새벽). 선생님이 "지금 바로 포털 업데이트해 줘"라고 하면:

1. 선생님 저장소를 원래 저장소와 맞춘다: `gh repo sync <계정>/portal --source a11y526/portal --branch main`, 도구가 없으면 선생님께: 내 저장소 첫 화면 → **Sync fork** → **Update branch**. `site.js`가 충돌하면 **선생님 것(새 서버 주소)을 남긴다**
2. 3-1·3-2를 다시 한다(01~04는 다시 실행해도 안전. 3-3·5는 다시 하지 않음)
3. 3-4로 확인
