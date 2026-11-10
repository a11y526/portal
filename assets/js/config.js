// 사이트마다 다른 값(Supabase 주소·공개 키·담당 반)은 site.js에 있다.
// 다른 선생님이 복사(Fork)한 사이트는 site.js만 자기 것으로 바꾸므로, 그 값을 이 파일에 다시 쓰지 않는다.
import { SUPABASE_URL, SUPABASE_ANON_KEY, CLASSES } from './site.js';
export { SUPABASE_URL, SUPABASE_ANON_KEY, CLASSES };

export const GRADE = 1;
// test반: 입구는 test.html 하나. 메인 입구·순위·진도에는 안 나오고 교사 화면에만 CLASSES 뒤에 붙는다
export const TEST_CLASS = 20;
export const TEACHER_CLASSES = [...CLASSES, TEST_CLASS];
// 반 이름 숫자 부분: 20 → 'test' (뒤에 '반'을 붙여 쓴다)
export const clsName = (n) => (Number(n) === TEST_CLASS ? 'test' : n);
// 원래 사이트(7~12반)인지. 학번으로 첫 가입·학생 안내는 다른 선생님 사이트에서만 보인다(2026-11-10 사용자 결정)
export const IS_MAIN = SUPABASE_URL.includes('sxejmhkevefwnpwldczt');
