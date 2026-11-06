# 과학 수업 포털 설치 (윈도우 PowerShell 5.1 이상)
# 설치.bat이 이 파일을 받아 실행한다. 하는 일:
#   1) 담당 반·선생님 체험 코드·교사 이메일과 비밀번호를 묻고
#   2) GitHub에 a11y526/science-portal을 복사(Fork)하고 사이트를 켠 뒤
#   3) Supabase에 새 프로젝트(서울)를 만들어 설치 SQL과 자동 업데이트를 넣고
#   4) 교사 계정을 만들고, 사이트가 새 서버를 쓰게 site.js를 바꾼다.
# 다시 실행해도 된다(있는 저장소·프로젝트·계정은 그대로 쓰고 SQL만 다시 넣음).
# 토큰·비밀번호·코드는 이 창에서만 쓰고 파일로 남기지 않는다.

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$SRC_OWNER = 'a11y526'
$REPO = 'science-portal'
$ORIGINAL_URL = 'https://sxejmhkevefwnpwldczt.supabase.co'
# 점검할 때만 바꾸는 주소들(평소에는 비어 있음)
$GH_API = if ($env:SP_GH_API) { $env:SP_GH_API } else { 'https://api.github.com' }
$SB_API = if ($env:SP_SB_API) { $env:SP_SB_API } else { 'https://api.supabase.com' }
$RAW = if ($env:SP_RAW) { $env:SP_RAW } else { "https://raw.githubusercontent.com/$SRC_OWNER/$REPO/main/" }
$SITE_FMT = if ($env:SP_SITE_FMT) { $env:SP_SITE_FMT } else { 'https://{0}.github.io/' + $REPO + '/' }
$HOST_FMT = if ($env:SP_SB_HOST_FMT) { $env:SP_SB_HOST_FMT } else { 'https://{0}.supabase.co' }
$WAIT = if ($env:SP_FAST) { 1 } else { 10 }
$script:answers = $null
if ($env:SP_ANSWERS) { $script:answers = New-Object System.Collections.Queue; ($env:SP_ANSWERS -split '\|') | ForEach-Object { $script:answers.Enqueue($_) } }

function Say([string]$t, [string]$color = 'Gray') { Write-Host $t -ForegroundColor $color }
function Step([int]$n, [string]$t) { Write-Host ''; Write-Host "[$n/8] $t" -ForegroundColor Cyan }
function Fail([string]$t) { Write-Host ''; Write-Host "설치를 멈췄어요: $t" -ForegroundColor Red; throw 'STOP' }
function Open([string]$url) { if (-not $env:SP_NOBROWSER) { try { Start-Process $url } catch { Say "  브라우저에서 이 주소를 열어 주세요: $url" Yellow } } }

function Ask([string]$prompt, [switch]$Secret) {
  if ($script:answers) { Write-Host "$prompt : (자동 입력)"; return [string]$script:answers.Dequeue() }
  if ($Secret) {
    $s = Read-Host $prompt -AsSecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
  }
  return (Read-Host $prompt)
}

# HTTP 한 번: @{ code; data; text } (오류여도 멈추지 않고 code로 돌려줌)
function Call([string]$method, [string]$url, $headers, $body = $null) {
  $p = @{ Method = $method; Uri = $url; Headers = $headers; UseBasicParsing = $true }
  if ($null -ne $body) {
    $p.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 20 -Compress))
    $p.ContentType = 'application/json; charset=utf-8'
  }
  try {
    $r = Invoke-WebRequest @p
    $text = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    $data = $null
    if ($text) { try { $data = $text | ConvertFrom-Json } catch { $data = $null } }
    return @{ code = [int]$r.StatusCode; data = $data; text = $text }
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    $text = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $text = $_.ErrorDetails.Message } else { $text = $_.Exception.Message }
    return @{ code = $code; data = $null; text = $text }
  }
}
function Need($r, [string]$what) {
  if ($r.code -lt 200 -or $r.code -ge 300) { Fail "$what ($($r.code)) $($r.text)" }
  return $r.data
}

function Download([string]$url) {
  $w = New-Object Net.WebClient
  $w.Encoding = [Text.Encoding]::UTF8
  $w.Headers.Add('Cache-Control', 'no-cache')
  $t = $w.DownloadString($url + '?t=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
  return $t.TrimStart([char]0xFEFF)
}

Write-Host ''
Write-Host '과학 수업 포털 설치' -ForegroundColor White
Say '필요한 것: GitHub 계정, Supabase 계정(둘 다 가입만 해 두면 됨). 10~20분쯤 걸려요.'

# ---------------------------------------------------------
Step 1 '담당 반과 계정 정하기'
$classes = @()
while ($classes.Count -eq 0) {
  $classInput = Ask '담당 반 번호를 쉼표로 (예: 1,2,3,4,5,6)'
  $nums = @($classInput -split '[,\s]+' | Where-Object { $_ -match '^\d{1,2}$' } | ForEach-Object { [int]$_ } | Where-Object { $_ -ge 1 -and $_ -le 15 } | Sort-Object -Unique)
  if ($nums.Count -gt 0) { $classes = $nums } else { Say '  1~15 사이 숫자를 넣어 주세요.' Yellow }
}
$code = ''
while ($code -notmatch '^\d{6}$') {
  $code = Ask '선생님 체험 코드(숫자 6자리, 반마다 0번 계정. 적어 두세요)' -Secret
  if ($code -notmatch '^\d{6}$') { Say '  숫자 6자리예요.' Yellow }
}
$email = ''
while ($email -notmatch '^[^@\s'']+@[^@\s'']+\.[^@\s'']+$') { $email = (Ask '관리 화면에 로그인할 이메일').Trim() }
$pw = ''
while ($pw.Length -lt 8) {
  $pw = Ask '관리 화면 비밀번호(8자 이상)' -Secret
  if ($pw.Length -lt 8) { Say '  8자 이상이에요.' Yellow }
}
Say ("  담당 반: " + (($classes | ForEach-Object { "$($_)반" }) -join ', ')) Green

# ---------------------------------------------------------
Step 2 'GitHub 연결'
Say '  브라우저에 GitHub 토큰 만들기 화면이 열려요.'
Say '  1) 아래쪽 [Generate token]을 누르고  2) 나온 글자(ghp_로 시작)를 복사해서  3) 여기에 붙여 넣고 Enter'
Say '  (붙여 넣어도 글자는 안 보여요. 오른쪽 클릭 또는 Ctrl+V)'
Open 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=science-portal%20setup'
$gh = ''
$login = $null
while (-not $login) {
  $gh = (Ask 'GitHub 토큰' -Secret).Trim()
  $GHH = @{ Authorization = "Bearer $gh"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'science-portal-setup' }
  $r = Call GET "$GH_API/user" $GHH
  if ($r.code -eq 200) { $login = $r.data.login } else { Say '  토큰이 맞지 않아요. 다시 복사해 주세요.' Yellow }
}
Say "  GitHub 계정: $login" Green
$siteUrl = [string]::Format($SITE_FMT, $login.ToLower())

# ---------------------------------------------------------
Step 3 'Supabase 연결'
Say '  브라우저에 Supabase 토큰 화면이 열려요(로그인이 필요하면 먼저 로그인).'
Say '  1) [Generate new token] → 이름 아무거나(예: portal) → [Generate token]  2) 나온 글자(sbp_로 시작)를 복사해서  3) 여기에 붙여 넣고 Enter'
Open 'https://supabase.com/dashboard/account/tokens'
$orgs = $null
while (-not $orgs) {
  $sbt = (Ask 'Supabase 토큰' -Secret).Trim()
  $SBH = @{ Authorization = "Bearer $sbt" }
  $r = Call GET "$SB_API/v1/organizations" $SBH
  if ($r.code -eq 200) { $orgs = @($r.data) } else { Say '  토큰이 맞지 않아요. 다시 복사해 주세요.' Yellow }
}
if ($orgs.Count -eq 0) { Fail 'Supabase 조직(organization)이 없어요. supabase.com에서 조직을 하나 만든 뒤 다시 실행해 주세요.' }
$org = $orgs[0]
if ($orgs.Count -gt 1) {
  for ($i = 0; $i -lt $orgs.Count; $i++) { Say ("  {0}) {1}" -f ($i + 1), $orgs[$i].name) }
  $pick = [int](Ask '쓸 조직 번호')
  if ($pick -ge 1 -and $pick -le $orgs.Count) { $org = $orgs[$pick - 1] }
}
Say "  Supabase 조직: $($org.name)" Green

# ---------------------------------------------------------
Step 4 '사이트 저장소 복사(Fork)'
$r = Call GET "$GH_API/repos/$login/$REPO" $GHH
if ($r.code -eq 200) {
  if (-not $r.data.fork -or $r.data.parent.full_name -ne "$SRC_OWNER/$REPO") { Fail "내 GitHub에 이미 '$REPO' 저장소가 있는데 복사본이 아니에요. 그 저장소 이름을 바꾸거나 지운 뒤 다시 실행해 주세요." }
  Say '  이미 복사해 둔 저장소를 써요.' Green
} else {
  $null = Need (Call POST "$GH_API/repos/$SRC_OWNER/$REPO/forks" $GHH @{ default_branch_only = $true }) '저장소 복사'
  Say '  복사하는 중…'
}
$ready = $false
for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
  $r = Call GET "$GH_API/repos/$login/$REPO/contents/assets/js/site.js" $GHH
  if ($r.code -eq 200) { $ready = $true } else { Start-Sleep -Seconds ([Math]::Max(1, [int]($WAIT / 2))) }
}
if (-not $ready) { Fail '복사한 저장소가 아직 준비되지 않았어요. 몇 분 뒤 다시 실행해 주세요.' }
Say "  github.com/$login/$REPO" Green

# ---------------------------------------------------------
Step 5 'Supabase 프로젝트 만들기(서울)'
$projects = @(Need (Call GET "$SB_API/v1/projects" $SBH) '프로젝트 목록')
$proj = $projects | Where-Object { $_.name -eq $REPO -and ($_.organization_id -eq $org.id -or $_.organization_slug -eq $org.slug -or -not $_.organization_id) } | Select-Object -First 1
if ($proj) {
  $ref = $proj.id
  Say "  이미 있는 프로젝트 '$REPO'를 써요." Green
} else {
  $dbpw = [Guid]::NewGuid().ToString('N') + 'Aa1!'
  $r = Call POST "$SB_API/v1/projects" $SBH @{ name = $REPO; organization_id = $org.id; region = 'ap-northeast-2'; db_pass = $dbpw }
  if ($r.code -lt 200 -or $r.code -ge 300) {
    if ($r.text -match 'limit|maximum|free') { Fail 'Supabase 무료 프로젝트는 2개까지예요. 안 쓰는 프로젝트를 지우거나 멈춘 뒤 다시 실행해 주세요.' }
    Fail "프로젝트 만들기 ($($r.code)) $($r.text)"
  }
  $ref = $r.data.id
  Say '  만드는 중이에요(몇 분 걸려요)…'
}
$status = ''
for ($i = 0; $i -lt 90 -and $status -ne 'ACTIVE_HEALTHY'; $i++) {
  $r = Call GET "$SB_API/v1/projects/$ref" $SBH
  if ($r.code -eq 200) { $status = [string]$r.data.status }
  if ($status -eq 'INACTIVE' -or $status -eq 'PAUSED') { Fail 'Supabase 프로젝트가 멈춰 있어요. supabase.com에서 [Restore]를 누른 뒤 다시 실행해 주세요.' }
  if ($status -ne 'ACTIVE_HEALTHY') { Start-Sleep -Seconds $WAIT }
}
if ($status -ne 'ACTIVE_HEALTHY') { Fail '프로젝트가 아직 준비되지 않았어요. 몇 분 뒤 다시 실행하면 이어서 해요.' }
$sbUrl = [string]::Format($HOST_FMT, $ref)
$keys = @(Need (Call GET "$SB_API/v1/projects/$ref/api-keys?reveal=true" $SBH) '키 받기')
$pub = ($keys | Where-Object { $_.type -eq 'publishable' } | Select-Object -First 1)
if (-not $pub) { $pub = ($keys | Where-Object { $_.name -eq 'anon' } | Select-Object -First 1) }
$sec = ($keys | Where-Object { $_.type -eq 'secret' } | Select-Object -First 1)
if (-not $sec) { $sec = ($keys | Where-Object { $_.name -eq 'service_role' } | Select-Object -First 1) }
if (-not $pub -or -not $sec) { Fail '프로젝트 키를 받지 못했어요.' }
Say "  $sbUrl" Green

# ---------------------------------------------------------
Step 6 '서버에 설치(SQL)'
function RunSql([string]$sql, [string]$what) {
  return Need (Call POST "$SB_API/v1/projects/$ref/database/query" $SBH @{ query = $sql }) $what
}
$classList = ($classes -join ', ')
foreach ($f in @('01_schema.sql', '02_policies.sql', '03_functions.sql', '04_seed.sql', '06_auto_update.sql')) {
  Say "  $f …"
  $t = Download ($RAW + 'supabase/' + $f)
  $t = $t.Replace($ORIGINAL_URL, $sbUrl)
  if ($f -eq '04_seed.sql') {
    $m = [regex]::Matches($t, 'unnest\(array\[[0-9, ]+\]\)')
    if ($m.Count -ne 1) { Fail '04_seed.sql에서 반 목록 줄을 찾지 못했어요. 원래 사이트 선생님께 알려 주세요.' }
    $t = [regex]::Replace($t, 'unnest\(array\[[0-9, ]+\]\)', "unnest(array[$classList])")
  }
  $null = RunSql $t $f
}
$cfg = @{ on = $true; source = $RAW + 'supabase/'; url = $sbUrl; classes = @($classes) } | ConvertTo-Json -Compress
$cfg = $cfg.Replace("'", "''")
$null = RunSql @"
update public.students set code_hash = extensions.crypt('$code', extensions.gen_salt('bf')) where number = 0 or class_id = 20;
delete from public.student_sessions where student_id in (select id from public.students where number = 0 or class_id = 20);
insert into public.settings (key, value) values ('auto_update', '$cfg'::jsonb)
on conflict (key) do update set value = public.settings.value || excluded.value;
"@ '체험 코드·자동 업데이트 설정'
$st = @(RunSql 'select public.setup_status() as s;' '설치 확인')
Say ("  설치됨: " + (($st[0].s.classes | ForEach-Object { "$($_)반" }) -join ', ')) Green

# ---------------------------------------------------------
Step 7 '교사 계정'
$AH = @{ apikey = $sec.api_key }
if ($sec.api_key -like 'eyJ*') { $AH.Authorization = "Bearer $($sec.api_key)" }
$r = Call POST "$sbUrl/auth/v1/admin/users" $AH @{ email = $email; password = $pw; email_confirm = $true }
if ($r.code -ge 200 -and $r.code -lt 300) { Say '  계정을 만들었어요.' Green }
elseif ($r.text -match 'already|registered|exists') { Say '  이미 있는 계정이에요(비밀번호는 예전 것 그대로).' Yellow }
else { Fail "교사 계정 만들기 ($($r.code)) $($r.text)" }
$emailSql = $email.ToLower().Replace("'", "''")
$t = @(RunSql @"
insert into public.teachers (user_id) select id from auth.users where lower(email) = '$emailSql' on conflict do nothing;
select count(*)::int as n from public.teachers;
"@ '교사 등록')
if ([int]$t[0].n -lt 1) { Fail '교사 등록이 되지 않았어요.' }
# 비밀번호 찾기 메일 등이 이 사이트로 오게(안 돼도 설치는 계속)
$null = Call PATCH "$SB_API/v1/projects/$ref/config/auth" $SBH @{ site_url = $siteUrl; uri_allow_list = ($siteUrl + '**') }

# ---------------------------------------------------------
Step 8 '사이트를 내 서버로 바꾸고 켜기'
$siteJs = @"
// 이 사이트만의 값. 설치 도우미(setup.html)가 만든 파일로 통째로 바꾼다.
// Project URL과 공개(publishable) 키만 넣는다. service_role(secret) 키는 절대 넣지 않는다.
export const SUPABASE_URL = '$sbUrl';
export const SUPABASE_ANON_KEY = '$($pub.api_key)';
export const CLASSES = [$classList];
"@
$cur = Need (Call GET "$GH_API/repos/$login/$REPO/contents/assets/js/site.js" $GHH) 'site.js 읽기'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($siteJs.Replace("`r`n", "`n") + "`n"))
$null = Need (Call PUT "$GH_API/repos/$login/$REPO/contents/assets/js/site.js" $GHH @{ message = '내 서버로 연결'; content = $b64; sha = $cur.sha }) 'site.js 바꾸기'
$r = Call POST "$GH_API/repos/$login/$REPO/pages" $GHH @{ source = @{ branch = 'main'; path = '/' } }
if (($r.code -lt 200 -or $r.code -ge 300) -and $r.code -ne 409) { Say "  사이트 켜기가 안 됐어요($($r.code)). 저장소 Settings → Pages에서 Branch를 main으로 Save 해 주세요." Yellow }
# 새 기능 자동 받기(매일 새벽)
$a1 = Call PUT "$GH_API/repos/$login/$REPO/actions/permissions" $GHH @{ enabled = $true; allowed_actions = 'all' }
$a2 = Call PUT "$GH_API/repos/$login/$REPO/actions/workflows/sync-upstream.yml/enable" $GHH
if ($a2.code -lt 200 -or $a2.code -ge 300) { Say "  자동 받기를 켜지 못했어요. 저장소 [Actions] 탭에서 초록 단추를 한 번 눌러 주세요." Yellow }
Say '  사이트가 바뀌기를 기다려요(몇 분)…'
$live = $false
for ($i = 0; $i -lt 60 -and -not $live; $i++) {
  try { $live = (Download ($siteUrl + 'assets/js/site.js')).Contains($sbUrl) } catch { $live = $false }
  if (-not $live) { Start-Sleep -Seconds $WAIT }
}

# ---------------------------------------------------------
Write-Host ''
Write-Host '설치 끝' -ForegroundColor Green
if (-not $live) { Say '  사이트가 아직 바뀌는 중이에요. 10분쯤 뒤에 열어 보세요.' Yellow }
$info = @"
과학 수업 포털
학생 입구: $siteUrl
관리 화면: ${siteUrl}teacher/  (이메일 $email)
선생님 체험 계정: 반마다 번호 0 + 체험 코드
새 기능: 매일 새벽 2시쯤 저절로 받아요
"@
Write-Host $info
$dir = if ($env:SP_OUTDIR) { $env:SP_OUTDIR } else { [Environment]::GetFolderPath('Desktop') }
try { [IO.File]::WriteAllText((Join-Path $dir '과학 포털 주소.txt'), $info.Replace("`n", "`r`n"), (New-Object Text.UTF8Encoding $true)); Say "  바탕화면에 '과학 포털 주소.txt'를 저장했어요." } catch {}
Say ''
Say '  다 썼으니 방금 만든 두 토큰은 지워도 돼요(자동 업데이트는 토큰 없이 돌아요).' Yellow
Say '  GitHub: Settings → Developer settings → Personal access tokens → science-portal setup → Delete'
Say '  Supabase: Account → Access Tokens → 방금 만든 토큰 → Revoke'
Open "${siteUrl}teacher/"
