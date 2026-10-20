// 캘린더 구독 피드 (아이폰·맥 캘린더 '구독 캘린더'): GET /functions/v1/calendar?t=<비밀 주소>
// 공개 키로 calendar_feed RPC만 부른다(service_role 안 씀). 토큰이 맞을 때만 수업일을 .ics로 돌려준다.
// 앞으로의 수업에는 진도 관리와 같은 규칙으로 '예정 차시'를 붙인다(한 시간에 한 차시씩)
// 배포: verify_jwt 끔(캘린더 앱은 로그인 정보를 보낼 수 없음, 토큰으로 확인)

type Day = { id: string; day: string; period: number; class_id: number; kind: string; memo: string; lesson_code: string | null };
type Lesson = { code: string; title: string; unit: string; sort: number; slide_count: number | null };
type Board = { class_id: number; lesson_code: string; slide_max: number | null; status: string };
type Feed = { ok: boolean; periods: [string, string][]; days: Day[]; lessons: Lesson[]; boards: Board[]; classes: { id: number; next_lesson: string | null }[] };

const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// 진도 관리(teacher-progress.js autoOf)와 같은 규칙: 다음에 할 차시의 진도 계획 안 순서
function nextIdx(classId: number, plan: Lesson[], boards: Board[], manual: string | null): number {
  let cur: { i: number; done: boolean } | null = null;
  for (const [i, l] of plan.entries()) {
    const bs = boards.filter((b) => b.class_id === classId && b.lesson_code === l.code);
    const slide = Math.max(0, ...bs.map((b) => b.slide_max ?? 0));
    if (slide > 0 || bs.some((b) => b.status === 'revealed')) cur = { i, done: !!l.slide_count && slide >= l.slide_count };
  }
  if (cur) return cur.done ? cur.i + 1 : cur.i;
  if (manual == null) return plan.length;
  const i = plan.findIndex((x) => x.code === manual);
  return i < 0 ? 0 : i;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// 한 줄 75바이트로 접기 (UTF-8 글자를 자르지 않게)
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch;
    n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const stamp = (day: string, hm: string) => `${day.replace(/-/g, '')}T${hm.replace(':', '')}00`;

function ics(feed: Feed): string {
  const plan = feed.lessons.filter((l) => l.unit)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.code.localeCompare(b.code));
  const title = (code: string) => { const l = feed.lessons.find((x) => x.code === code); return l?.title ? `${code} ${l.title}` : code; };
  const today = kstToday();
  // 반마다 앞으로의 수업에 예정 차시를 차례로
  const planned = new Map<string, string>();
  for (const c of feed.classes) {
    let i = nextIdx(c.id, plan, feed.boards, c.next_lesson);
    for (const d of feed.days) {
      if (d.class_id !== c.id || d.kind !== '수업' || d.day < today || d.lesson_code) continue;
      if (i < plan.length) planned.set(d.id, plan[i].code);
      i++;
    }
  }
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//class-portal//progress//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:과학 수업', 'X-WR-TIMEZONE:Asia/Seoul', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE',
  ];
  for (const d of feed.days) {
    const t = feed.periods[d.period - 1];
    if (!t) continue;
    let summary = `${d.class_id}반`;
    const desc: string[] = [`${d.period}교시`];
    if (d.kind === '수업') {
      if (d.lesson_code) summary += ` ${title(d.lesson_code)}`;
      else if (planned.has(d.id)) { summary += ` ${title(planned.get(d.id)!)}`; desc.push('예정 차시'); }
      else summary += ' 과학';
    } else summary += ` ${d.kind}`;
    if (d.memo) { summary += ` · ${d.memo}`; desc.push(d.memo); }
    L.push('BEGIN:VEVENT', `UID:${d.id}@class-portal`, `DTSTAMP:${now}`,
      `DTSTART;TZID=Asia/Seoul:${stamp(d.day, t[0])}`, `DTEND;TZID=Asia/Seoul:${stamp(d.day, t[1])}`,
      `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(desc.join('\n'))}`,
      ...(d.kind === '수업' ? [] : ['TRANSP:TRANSPARENT']), 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const r = await fetch(`${URL_}/rest/v1/rpc/calendar_feed`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }),
  });
  if (!r.ok) return new Response('error', { status: 502 });
  const feed = (await r.json()) as Feed;
  if (!feed?.ok) return new Response('not found', { status: 404 });
  return new Response(ics(feed), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="class.ics"' },
  });
});
