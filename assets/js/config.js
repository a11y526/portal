// Supabase 프로젝트 설정
// Project URL과 anon(public) 키만 넣는다. service_role(secret) 키는 절대 넣지 않는다.
export const SUPABASE_URL = 'https://sxejmhkevefwnpwldczt.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_gdlN0VcGUXOPkXLSqfJn0Q_VYES-EwK';

export const GRADE = 1;
export const CLASSES = [7, 8, 9, 10, 11, 12];
// test반: 입구는 test.html 하나. 메인 입구·순위·진도에는 안 나오고 교사 화면에만 CLASSES 뒤에 붙는다
export const TEST_CLASS = 20;
export const TEACHER_CLASSES = [...CLASSES, TEST_CLASS];
// 반 이름 숫자 부분: 20 → 'test' (뒤에 '반'을 붙여 쓴다)
export const clsName = (n) => (Number(n) === TEST_CLASS ? 'test' : n);
